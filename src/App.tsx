import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Room } from './ui/Room.tsx';
import { AgentPanel, ButtonPad, EventFeed, ResearcherPanel } from './ui/Panels.tsx';
import { Replay } from './ui/Replay.tsx';
import { BeliefTimeline, MetricsPanel, PredictionLedger } from './ui/Behaviour.tsx';
import { WirePanel } from './ui/Wire.tsx';
import { AgentConsole, type ConsoleConfig } from './ui/Console.tsx';
import { PROTOCOLS, estimateCalls, type Arm, type Protocol } from './experiment.ts';
import { LEVELS } from './engine/levels.ts';
import { solve } from './engine/solver.ts';
import { CHANGED_RULES, DEFAULT_RULES } from './engine/engine.ts';
import type { StrategyName } from './agent/memory.ts';
import { Run, type Condition, type Driver, type RunConfig } from './runner.ts';

interface ServerStatus {
  provider: 'anthropic' | 'openai-compatible' | 'codex';
  model: string;
  effort: string;
  endpoint: string;
  hasKey: boolean;
  /** human-readable subject, e.g. "openrouter.ai - anthropic/claude-sonnet-5" */
  label: string;
}

const STRATEGIES: StrategyName[] = ['flat', 'structured'];

function newRunId(prefix: string) {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

function download(name: string, text: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [strategy, setStrategy] = useState<StrategyName>('structured');
  const [condition, setCondition] = useState<Condition>('hidden');
  const [driver, setDriver] = useState<Driver>('manual');
  const [budget, setBudget] = useState(30);
  const [seed, setSeed] = useState(1);
  // Empty means 'whatever the server is configured for'. Set from the console
  // page, fixed into RunConfig when a run is created, logged in run_start.
  const [model, setModel] = useState('');
  const [showResearcher, setShowResearcher] = useState(true);
  const [tab, setTab] = useState<'console' | 'live' | 'behaviour' | 'wire' | 'replay'>('console');
  const [pick, setPick] = useState<number | null>(null);
  const [protocol, setProtocol] = useState<Protocol>(PROTOCOLS[0]);

  const [, force] = useState(0);
  const emit = useCallback(() => force((n) => n + 1), []);
  const runRef = useRef<Run | null>(null);

  /**
   * Build a fresh run.
   *
   * `over` exists because the obvious version was silently wrong. A control
   * that calls `setModel(x)` and then `makeRun()` does NOT get a run using `x`:
   * this callback closed over the previous `model`, so the run was created with
   * the old value and quietly went to whatever the server was configured for.
   * The UI showed the new model, the log recorded a different subject, and
   * nothing anywhere disagreed. Callers that are changing settings must hand
   * those settings in rather than hoping the closure has caught up.
   */
  const makeRun = useCallback(
    (d: Driver = driver, over: Partial<RunConfig> = {}) => {
      const merged = {
        strategy,
        condition,
        actionBudgetPerLevel: budget,
        seed,
        model: model.trim() || undefined,
        ...over,
      };
      const cfg: RunConfig = {
        ...merged,
        runId: newRunId(`${merged.strategy}-${merged.condition}-${d}`),
        driver: d,
      };
      runRef.current = new Run(cfg, emit);
      emit();
    },
    [strategy, condition, driver, budget, seed, model, emit],
  );

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (!runRef.current) makeRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The console page exists to drive a model, so a run reached from it is an
  // LLM run. Switched once, on arrival, and only while the run is still empty:
  // converting it later would mean silently discarding a run in progress, which
  // is what the first version of the Start button did.
  useEffect(() => {
    if (tab !== 'console') return;
    if (driver === 'llm') return;
    if ((runRef.current?.state.globalStep ?? 0) > 0) return;
    setDriver('llm');
    makeRun('llm');
  }, [tab, driver, makeRun]);

  const run = runRef.current;
  const s = run?.state;
  const level = s ? LEVELS[s.levelIndex] : LEVELS[0];

  // Reference path for the CURRENT rule set — researcher information only.
  const reference = useMemo(
    () => (s ? solve(level, s.rules)?.length ?? null : null),
    [level, s?.rules.swapped],
  );

  const started = (s?.globalStep ?? 0) > 0;
  const locked = started && !s?.finished;
  const busy = Boolean(s?.inFlight || s?.running);

  const [experiment, setExperiment] = useState<{
    running: boolean;
    log: string[];
    rows: Array<Record<string, unknown>>;
  }>({ running: false, log: [], rows: [] });

  async function exportRun() {
    if (!s) return;
    const jsonl = await fetch(`/api/runs/${s.config.runId}`).then((r) =>
      r.ok ? r.text() : '',
    );
    if (jsonl) download(`${s.config.runId}.jsonl`, jsonl, 'application/x-ndjson');
    download(`${s.config.runId}.summary.json`, JSON.stringify(run!.summary(), null, 2));
  }

  /** Drive a run forward until it finishes or `stop` says otherwise. */
  async function drive(r: Run, stop: () => boolean) {
    while (!r.state.finished && !stop()) {
      const ok = await r.stepOnce();
      if (!ok) return false;
    }
    return true;
  }

  /**
   * Run a declared protocol.
   *
   * Never fires on its own, and the button states the worst-case cost in model
   * calls before a single one is spent. With a shared prefix, rooms 1-6 are
   * played once per strategy and snapshotted, so the conditions branch from
   * identical history and differ only in the intervention.
   */
  async function runExperiment(p: Protocol) {
    setExperiment({ running: true, log: [], rows: [] });
    const rows: Array<Record<string, unknown>> = [];
    const say = (line: string) => setExperiment((e) => ({ ...e, log: [...e.log, line] }));

    const record = (
      rep: number,
      arm: Arm,
      branch: Run,
      base: { rooms: number; steps: number },
    ) => {
      const m = branch.metrics();
      rows.push({
        protocol: p.id,
        rep: rep + 1,
        strategy: arm.strategy,
        condition: arm.condition,
        rooms_solved: m.roomsSolved - base.rooms,
        actions: m.totalActions - base.steps,
        accuracy: m.accuracy === null ? '' : m.accuracy.toFixed(2),
        first_evidence: m.firstEvidenceStep ?? '',
        first_revised_prediction: m.firstRevisedPredictionStep ?? '',
        detection_delay: m.detectionDelay ?? '',
        post_change_room: m.postChangeCompletionStep ?? '',
        recovered_at: m.recoveredAtStep ?? '',
        transfer_at: m.transferStep ?? '',
        rule_relevant_violations: m.ruleRelevantViolations,
        stale_rule_predictions: m.staleRulePredictions,
        stale_rule_actions: m.staleRuleActions,
        stale_rule_deaths: m.staleRuleDeaths,
        collateral_drop: m.collateralDrop === null ? '' : m.collateralDrop.toFixed(2),
        demoted_after_change: m.demotedAfterChange.join(' '),
        invalid_replies: branch.state.invalidReplies,
        model_calls: branch.state.usage.calls,
        tokens: branch.state.usage.input + branch.state.usage.output,
      });
      setExperiment((e) => ({ ...e, rows: [...rows] }));
    };

    for (let rep = 0; rep < p.repeats; rep++) {
      if (p.sharedPrefix) {
        for (const strat of [...new Set(p.arms.map((a) => a.strategy))]) {
          const prefix = new Run(
            {
              runId: newRunId(`${p.id}-${strat}-prefix-r${rep}`),
              strategy: strat,
              condition: 'stable',
              driver: 'llm',
              actionBudgetPerLevel: p.budgetPerRoom,
              seed: seed + rep,
            },
            emit,
          );
          runRef.current = prefix;
          say(`[${strat}] rep ${rep + 1}: rooms 1-6`);
          await drive(prefix, () => prefix.state.levelIndex >= 6);
          const snap = prefix.snapshot();
          const base = { rooms: prefix.metrics().roomsSolved, steps: prefix.state.globalStep };
          say(`[${strat}] prefix done, ${snap.levelsCompleted}/6 solved`);

          for (const arm of p.arms.filter((a) => a.strategy === strat)) {
            const branch = new Run(
              {
                runId: newRunId(`${p.id}-${strat}-${arm.condition}-r${rep}`),
                strategy: strat,
                condition: arm.condition,
                driver: 'llm',
                actionBudgetPerLevel: p.budgetPerRoom,
                seed: seed + rep,
              },
              emit,
              snap,
            );
            runRef.current = branch;
            say(`[${strat}/${arm.condition}] rooms 7-8`);
            await drive(branch, () => false);
            record(rep, arm, branch, base);
          }
        }
      } else {
        for (const arm of p.arms) {
          const r = new Run(
            {
              runId: newRunId(`${p.id}-${arm.strategy}-${arm.condition}-r${rep}`),
              strategy: arm.strategy,
              condition: arm.condition,
              driver: 'llm',
              actionBudgetPerLevel: p.budgetPerRoom,
              seed: seed + rep,
            },
            emit,
          );
          runRef.current = r;
          say(`[${arm.strategy}/${arm.condition}] rep ${rep + 1}: full campaign`);
          await drive(r, () => false);
          record(rep, arm, r, { rooms: 0, steps: 0 });
        }
      }
    }
    say('protocol finished');
    setExperiment((e) => ({ ...e, running: false }));
    const header = Object.keys(rows[0] ?? { note: 'no rows' });
    download(
      `aura-${p.id}-${Date.now()}.csv`,
      [header.join(','), ...rows.map((r) => header.map((h) => r[h] ?? '').join(','))].join(
        String.fromCharCode(10),
      ),
      'text/csv',
    );
  }

  if (!s) return <div style={{ padding: 40 }}>starting…</div>;

  return (
    <div className="app">
      <header className="top">
        <h1 className="pix">AURA ROOMS</h1>
        <span className="tag">
          hidden-rule-change testbed · room {s.levelIndex + 1}/8 · {s.globalStep} actions
        </span>
        <span className="spacer" />
      </header>

      <nav className="tabs">
        {([
          ['console', 'Agent console'],
          ['live', 'Play'],
          ['behaviour', 'Behaviour'],
          ['wire', 'Wire log'],
          ['replay', 'Replay'],
        ] as const).map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
            {k === 'behaviour' && s.records.length ? ` (${s.records.length})` : ''}
            {k === 'wire' && s.transcript.length ? ` (${s.transcript.length})` : ''}
          </button>
        ))}
      </nav>

      {status && !status.hasKey && (
        <div className="banner info">
          No model credentials on the server, so the LLM agent is unavailable. Manual play, the
          random agent, and replay all work. Set <code>OPENROUTER_API_KEY</code> (or{' '}
          <code>ANTHROPIC_API_KEY</code>, or <code>AURA_PROVIDER=codex</code>) and restart to
          enable it.
        </div>
      )}
      {status && status.hasKey && tab !== 'console' && (
        <div className="banner info">
          Subject: <b>{status.label}</b>. Every call is recorded in full under the Wire log tab.
        </div>
      )}
      {s.error && <div className="banner err">Provider error — {s.error}</div>}
      {s.config.manualIntervention && (
        <div className="banner staged">
          Rule changed by hand. This run is a demonstration and is tagged as manual in the log;
          it is not experimental data.
        </div>
      )}

      {tab === 'console' ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <AgentConsole
            s={s}
            subject={status?.label ?? 'checking...'}
            hasKey={Boolean(status?.hasKey)}
            locked={locked}
            busy={busy}
            config={{ model, strategy, condition, budget }}
            onConfig={(c: ConsoleConfig) => {
              setModel(c.model);
              setStrategy(c.strategy);
              setCondition(c.condition);
              setBudget(c.budget);
              // The console only ever drives the model, so a config change there
              // rebuilds the run as an LLM run rather than leaving it on manual.
              setDriver('llm');
              // hand the new values in; see the note on makeRun
              setTimeout(
                () =>
                  makeRun('llm', {
                    strategy: c.strategy,
                    condition: c.condition,
                    actionBudgetPerLevel: c.budget,
                    model: c.model.trim() || undefined,
                  }),
                0,
              );
            }}
            onStart={() => void run!.loop()}
            onPause={() => run!.pause()}
            onStep={() => void run!.stepOnce()}
            onRestart={() => makeRun('llm')}
            onExport={() => void exportRun()}
          />
        </div>
      ) : tab === 'wire' ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <WirePanel s={s} />
        </div>
      ) : tab === 'replay' ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <Replay />
        </div>
      ) : tab === 'behaviour' ? (
        <>
          <div>
            <div className="panel">
              <div className="stage">
                <div className="roombar">
                  <span>
                    {pick !== null ? `STEP ${s.records[pick]?.global_step}` : 'LATEST'}
                    <span className="muted">
                      {' '}
                      · room {pick !== null ? s.records[pick]?.level : s.levelIndex + 1}
                    </span>
                  </span>
                  <span className="muted">
                    {pick !== null ? s.records[pick]?.hypothesis : 'pick a step to inspect it'}
                  </span>
                </div>
                <Room
                  level={pick !== null ? LEVELS[s.records[pick].level - 1] : level}
                  path={
                    pick !== null
                      ? (s.records[pick] as any).researcher.path
                      : s.path
                  }
                  animToken={pick ?? s.animToken}
                  highlight={
                    pick !== null
                      ? (s.records[pick] as any).researcher.entity_after
                      : { x: s.entity.x, y: s.entity.y }
                  }
                  celebrate={pick !== null ? s.records[pick].level_complete : false}
                />
                {pick !== null && (
                  <button className="btn" onClick={() => setPick(null)}>
                    ← back to live
                  </button>
                )}
              </div>
            </div>
            <BeliefTimeline steps={s.records} onPick={setPick} selected={pick ?? undefined} />
          </div>
          <div>
            <MetricsPanel steps={s.records} />
            <PredictionLedger steps={s.records} onPick={setPick} selected={pick ?? undefined} />
          </div>
        </>
      ) : (
        <>
          <div>
            <div className="panel">
              <div className="stage">
                <div className="roombar">
                  <span>
                    ROOM {s.levelIndex + 1} <span className="muted">/ 8</span>
                  </span>
                  <span className="muted">
                    {s.levelStep} / {s.config.actionBudgetPerLevel} actions
                    {reference !== null && ` · reference ${reference}`}
                  </span>
                </div>
                <Room
                  level={level}
                  path={s.path}
                  animToken={s.animToken}
                  highlight={{ x: s.entity.x, y: s.entity.y }}
                  celebrate={s.lastAction?.room_changed ?? false}
                />
                <ButtonPad
                  onPress={(b) => {
                    run!.pressManual(b);
                  }}
                  last={s.lastAction?.button ?? null}
                  disabled={s.config.driver !== 'manual' || busy || s.finished}
                />
                {s.config.driver !== 'manual' && (
                  <span style={{ color: 'var(--dim)', fontSize: 11 }}>
                    buttons are driven by the {s.config.driver === 'llm' ? 'model' : 'random agent'}
                  </span>
                )}
              </div>
            </div>

            <div className="panel">
              <h2>Run control</h2>
              <div className="ctl">
                <button
                  className="btn primary"
                  disabled={busy || s.finished || s.config.driver === 'manual'}
                  onClick={() => void run!.loop()}
                >
                  ▶ Start
                </button>
                <button className="btn" disabled={!s.running} onClick={() => run!.pause()}>
                  ❚❚ Pause
                </button>
                <button
                  className="btn"
                  disabled={busy || s.finished || s.config.driver === 'manual'}
                  onClick={() => void run!.stepOnce()}
                >
                  ⤳ One step
                </button>
                <button className="btn" onClick={() => makeRun()}>
                  ↺ Restart, empty memory
                </button>
                <button className="btn warn" disabled={s.rules.swapped} onClick={() => run!.forceRuleChange()}>
                  ⚡ Change a rule now
                </button>
                <button className="btn" onClick={() => void exportRun()}>
                  ⭳ Export log
                </button>
              </div>

              <div className="ctl" style={{ marginTop: 12 }}>
                <label className="field">
                  Driver
                  <select
                    value={s.config.driver}
                    onChange={(e) => {
                      setDriver(e.target.value as Driver);
                      const d = e.target.value as Driver;
                      setTimeout(() => makeRun(d), 0);
                    }}
                  >
                    <option value="manual">manual play</option>
                    <option value="random">random agent</option>
                    <option value="llm" disabled={!status?.hasKey}>
                      LLM agent
                    </option>
                  </select>
                </label>
                <label className="field">
                  Memory strategy
                  <select
                    value={strategy}
                    disabled={locked}
                    onChange={(e) => setStrategy(e.target.value as StrategyName)}
                  >
                    {STRATEGIES.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Condition
                  <select
                    value={condition}
                    disabled={locked}
                    onChange={(e) => setCondition(e.target.value as Condition)}
                  >
                    <option value="stable">stable world</option>
                    <option value="hidden">hidden change</option>
                    <option value="notified">announced change</option>
                  </select>
                </label>
                <label className="field">
                  Budget / room
                  <input
                    type="number"
                    min={4}
                    max={200}
                    value={budget}
                    disabled={locked}
                    style={{ width: 74 }}
                    onChange={(e) => setBudget(Number(e.target.value) || 30)}
                  />
                </label>
                <label className="field">
                  Seed
                  <input
                    type="number"
                    value={seed}
                    disabled={locked}
                    style={{ width: 66 }}
                    onChange={(e) => setSeed(Number(e.target.value) || 0)}
                  />
                </label>
              </div>
              {locked && (
                <p style={{ color: 'var(--dim)', fontSize: 11, margin: '8px 0 0' }}>
                  Strategy, condition, budget and seed are fixed once a run has started. Restart to
                  change them — switching mid-run would make the log describe two experiments.
                </p>
              )}
            </div>

            <div className="panel">
              <h2>Experiment</h2>
              <label className="field" style={{ marginBottom: 10 }}>
                Protocol
                <select
                  value={protocol.id}
                  onChange={(e) =>
                    setProtocol(PROTOCOLS.find((p) => p.id === e.target.value) ?? PROTOCOLS[0])
                  }
                >
                  {PROTOCOLS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              <dl className="kv">
                <dt>Asks</dt>
                <dd>{protocol.asks}</dd>
                <dt>Decided by</dt>
                <dd>{protocol.decidedBy}</dd>
                <dt>Arms</dt>
                <dd>
                  {protocol.arms.map((a) => `${a.strategy}/${a.condition}`).join(', ')}
                </dd>
                <dt>Repeats</dt>
                <dd>{protocol.repeats}</dd>
                <dt>Shared prefix</dt>
                <dd>{protocol.sharedPrefix ? 'rooms 1-6 played once per strategy' : 'no'}</dd>
              </dl>
              <div className="ctl" style={{ marginTop: 10 }}>
                <button
                  className="btn warn"
                  disabled={experiment.running || !status?.hasKey}
                  onClick={() => {
                    const n = estimateCalls(protocol);
                    if (confirm(`"${protocol.title}" spends real API calls: up to about ${n}. Continue?`))
                      void runExperiment(protocol);
                  }}
                >
                  Run — up to ~{estimateCalls(protocol)} model calls
                </button>
                {experiment.running && <span style={{ color: 'var(--gold)' }}>running…</span>}
              </div>
              {experiment.log.length > 0 && (
                <pre className="flatmem" style={{ marginTop: 10, maxHeight: 130 }}>
                  {experiment.log.join(String.fromCharCode(10))}
                </pre>
              )}
              {experiment.rows.length > 0 && (
                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table className="truth">
                    <tbody>
                      <tr>
                        {Object.keys(experiment.rows[0]).map((h) => (
                          <td key={h} style={{ color: 'var(--gold)' }}>{h}</td>
                        ))}
                      </tr>
                      {experiment.rows.map((r, i) => (
                        <tr key={i}>
                          {Object.keys(experiment.rows[0]).map((h) => (
                            <td key={h}>{String(r[h] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div>
            <AgentPanel s={s} />
            <ResearcherPanel
              s={s}
              open={showResearcher}
              onToggle={() => setShowResearcher((v) => !v)}
              model={status?.model ?? 'unknown'}
            />
            <EventFeed feed={s.feed} />
          </div>
        </>
      )}
    </div>
  );
}

/** Reference lengths under both rule sets, for the researcher's own sanity. */
export function referenceTable() {
  return LEVELS.map((l) => ({
    level: l.id,
    original: solve(l, DEFAULT_RULES)?.length ?? null,
    changed: solve(l, CHANGED_RULES)?.length ?? null,
  }));
}
