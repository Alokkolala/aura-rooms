import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Room } from './ui/Room.tsx';
import { AgentPanel, ButtonPad, EventFeed, ResearcherPanel } from './ui/Panels.tsx';
import { Replay } from './ui/Replay.tsx';
import { LEVELS } from './engine/levels.ts';
import { solve } from './engine/solver.ts';
import { CHANGED_RULES, DEFAULT_RULES } from './engine/engine.ts';
import type { StrategyName } from './agent/memory.ts';
import { Run, type Condition, type Driver, type RunConfig } from './runner.ts';

interface ServerStatus {
  model: string;
  effort: string;
  endpoint: string;
  hasKey: boolean;
}

const STRATEGIES: StrategyName[] = ['flat', 'structured'];
const CONDITIONS: Condition[] = ['stable', 'hidden', 'notified'];

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
  const [showResearcher, setShowResearcher] = useState(true);
  const [tab, setTab] = useState<'live' | 'replay'>('live');

  const [, force] = useState(0);
  const emit = useCallback(() => force((n) => n + 1), []);
  const runRef = useRef<Run | null>(null);

  const makeRun = useCallback(
    (d: Driver = driver) => {
      const cfg: RunConfig = {
        runId: newRunId(`${strategy}-${condition}-${d}`),
        strategy,
        condition,
        driver: d,
        actionBudgetPerLevel: budget,
        seed,
      };
      runRef.current = new Run(cfg, emit);
      emit();
    },
    [strategy, condition, driver, budget, seed, emit],
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

  const run = runRef.current;
  const s = run?.state;
  const level = s ? LEVELS[s.levelIndex] : LEVELS[0];

  // Reference path for the CURRENT rule set — researcher information only.
  const reference = useMemo(
    () => (s ? solve(level, s.rules)?.length ?? null : null),
    [level, s?.rules.slipperyEnabled],
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
   * Pilot sweep. Both strategies across all three conditions, sharing one
   * prefix per strategy: rooms 1-6 are played once, snapshotted, and the three
   * continuations branch from identical history. That is both cheaper and a
   * cleaner comparison than replaying the prefix three times, because the
   * conditions then differ only in the intervention.
   *
   * Never fires on its own. The button says how many model calls it could cost
   * before anything is spent.
   */
  async function runExperiment(repeats: number) {
    setExperiment({ running: true, log: [], rows: [] });
    const rows: Array<Record<string, unknown>> = [];
    const say = (line: string) =>
      setExperiment((e) => ({ ...e, log: [...e.log, line] }));

    for (let rep = 0; rep < repeats; rep++) {
      for (const strat of STRATEGIES) {
        const prefixCfg: RunConfig = {
          runId: newRunId(`exp-${strat}-prefix-r${rep}`),
          strategy: strat,
          condition: 'stable',
          driver: 'llm',
          actionBudgetPerLevel: budget,
          seed: seed + rep,
        };
        const prefix = new Run(prefixCfg, emit);
        runRef.current = prefix;
        say(`[${strat}] rep ${rep + 1}: playing rooms 1-6`);
        await drive(prefix, () => prefix.state.levelIndex >= 6);
        const snap = prefix.snapshot();
        say(`[${strat}] rep ${rep + 1}: prefix done, ${snap.levelsCompleted}/6 solved`);

        for (const cond of CONDITIONS) {
          const cfg: RunConfig = {
            runId: newRunId(`exp-${strat}-${cond}-r${rep}`),
            strategy: strat,
            condition: cond,
            driver: 'llm',
            actionBudgetPerLevel: budget,
            seed: seed + rep,
          };
          const branch = new Run(cfg, emit, snap);
          runRef.current = branch;
          say(`[${strat}/${cond}] rep ${rep + 1}: rooms 7-8`);
          await drive(branch, () => false);
          const sum = branch.summary();
          rows.push({
            rep: rep + 1,
            strategy: strat,
            condition: cond,
            prefix_solved_of_6: snap.levelsCompleted,
            rooms_7_8_solved: sum.levels_completed - snap.levelsCompleted,
            actions_after_branch: sum.total_actions - snap.globalStep,
            first_telling_action: sum.first_discriminating_step,
            first_success_after_change: sum.first_success_after_change,
            invalid_replies: sum.invalid_replies,
            model_calls: sum.usage.calls,
            tokens: sum.usage.input + sum.usage.output,
          });
          setExperiment((e) => ({ ...e, rows: [...rows] }));
        }
      }
    }
    say('sweep finished');
    setExperiment((e) => ({ ...e, running: false }));
    const header = Object.keys(rows[0] ?? { note: 'no rows' });
    download(
      `aura-pilot-${Date.now()}.csv`,
      [header.join(','), ...rows.map((r) => header.map((h) => r[h] ?? '').join(','))].join('\n'),
      'text/csv',
    );
  }

  if (!s) return <div style={{ padding: 40 }}>starting…</div>;

  const estCalls = 2 * (6 * budget) + 2 * 3 * (2 * budget);

  return (
    <div className="app">
      <header className="top">
        <h1 className="pix">AURA ROOMS</h1>
        <span className="tag">
          hidden-rule-change testbed · room {s.levelIndex + 1}/8 · {s.globalStep} actions
        </span>
        <span className="spacer" />
        <button className="btn" onClick={() => setTab(tab === 'live' ? 'replay' : 'live')}>
          {tab === 'live' ? 'Open replay' : 'Back to live'}
        </button>
      </header>

      {status && !status.hasKey && (
        <div className="banner info">
          No API key on the server, so the LLM agent is unavailable. Manual play, the random
          agent, and replay all work. Set <code>ANTHROPIC_API_KEY</code> and restart to enable it.
        </div>
      )}
      {s.error && <div className="banner err">Provider error — {s.error}</div>}
      {s.config.manualIntervention && (
        <div className="banner staged">
          Rule changed by hand. This run is a demonstration and is tagged as manual in the log;
          it is not experimental data.
        </div>
      )}

      {tab === 'replay' ? (
        <div style={{ gridColumn: '1 / -1' }}>
          <Replay />
        </div>
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
                  celebrate={s.lastAction?.level_complete ?? false}
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
                <button className="btn warn" disabled={s.rules.slipperyEnabled === false} onClick={() => run!.forceRuleChange()}>
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
              <h2>Pilot sweep</h2>
              <p style={{ fontSize: 12, color: 'var(--dim)', marginTop: 0 }}>
                Both strategies across all three conditions. Rooms 1–6 are played once per
                strategy and snapshotted, so the three continuations branch from identical
                history. Nothing runs until you press the button.
              </p>
              <div className="ctl">
                <button
                  className="btn warn"
                  disabled={experiment.running || !status?.hasKey}
                  onClick={() => {
                    if (
                      confirm(
                        `This spends real API calls: up to about ${estCalls} of them at the current budget. Continue?`,
                      )
                    )
                      void runExperiment(1);
                  }}
                >
                  Run 1 repeat (≤ ~{estCalls} model calls)
                </button>
                {experiment.running && <span style={{ color: 'var(--gold)' }}>running…</span>}
              </div>
              {experiment.log.length > 0 && (
                <pre className="flatmem" style={{ marginTop: 10, maxHeight: 130 }}>
                  {experiment.log.join('\n')}
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
