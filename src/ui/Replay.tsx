import { useEffect, useMemo, useState } from 'react';
import { Room } from './Room.tsx';
import { BeliefTimeline, MetricsPanel, PredictionLedger } from './Behaviour.tsx';
import type { StepRecord } from '../metrics.ts';
import { LEVELS } from '../engine/levels.ts';
import { step } from '../engine/engine.ts';

/**
 * Replay a recorded run from its JSONL, with no model calls.
 *
 * It re-executes each recorded press through the engine and compares the result
 * with what the log says happened. A mismatch means the log and the engine have
 * drifted apart, and it is shown rather than hidden — a replay that silently
 * "fixed" a discrepancy would make the log useless as evidence.
 */

interface RunFile {
  id: string;
  bytes: number;
  mtime: number;
}

export function Replay() {
  const [runs, setRuns] = useState<RunFile[]>([]);
  const [chosen, setChosen] = useState('');
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const [header, setHeader] = useState<Record<string, unknown> | null>(null);
  const [i, setI] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/runs')
      .then((r) => r.json())
      .then(setRuns)
      .catch(() => setErr('could not list runs'));
  }, []);

  async function load(id: string) {
    setChosen(id);
    setErr(null);
    try {
      const text = await fetch(`/api/runs/${id}`).then((r) => r.text());
      const records = text
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      setHeader((records.find((r) => r.type === 'run_start') as any) ?? null);
      setSteps(records.filter((r) => r.type === 'step') as unknown as StepRecord[]);
      setI(0);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  const cur = steps[i];
  // the behaviour views read the same shape the log already stores
  const asRecords = steps;

  // Re-derive the outcome from the engine and compare it to the record.
  const check = useMemo(() => {
    if (!cur) return null;
    const lv = LEVELS[cur.level - 1];
    // A recording made on an older engine can reference a room that has since
    // changed shape, so the stored position may be outside the current grid.
    // That used to throw and take the whole viewer down; an incompatible
    // recording is a thing to REPORT, not a crash.
    const p = cur.researcher.entity_before;
    if (!lv || p.y < 0 || p.y >= lv.h || p.x < 0 || p.x >= lv.w)
      return { same: false, incompatible: true as const, recomputed: null };
    try {
      const r = step(lv, p, cur.button, cur.researcher.true_rules);
      const same =
        JSON.stringify(r.state) === JSON.stringify(cur.researcher.entity_after) &&
        r.complete === cur.level_complete;
      return { same, incompatible: false as const, recomputed: r };
    } catch {
      return { same: false, incompatible: true as const, recomputed: null };
    }
  }, [cur]);

  return (
    <>
      <div className="panel">
        <h2>Replay</h2>
        <div className="ctl">
          <label className="field">
            Recorded run
            <select value={chosen} onChange={(e) => void load(e.target.value)}>
              <option value="">— pick a run —</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} ({(r.bytes / 1024).toFixed(0)} kB)
                </option>
              ))}
            </select>
          </label>
          {steps.length > 0 && (
            <>
              <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>
                ◀ prev
              </button>
              <button className="btn" disabled={i >= steps.length - 1} onClick={() => setI(i + 1)}>
                next ▶
              </button>
              <span style={{ color: 'var(--dim)' }}>
                step {i + 1} / {steps.length}
              </span>
            </>
          )}
        </div>
        {err && <div className="banner err" style={{ marginTop: 10 }}>{err}</div>}
        {runs.length === 0 && !err && (
          <p style={{ color: 'var(--dim)' }}>
            No runs recorded yet. Play or run the agent once and the log appears here.
          </p>
        )}
        {steps.length > 0 && (
          <input
            className="scrub"
            type="range"
            min={0}
            max={steps.length - 1}
            value={i}
            onChange={(e) => setI(Number(e.target.value))}
            style={{ marginTop: 10 }}
          />
        )}
      </div>

      {steps.length > 0 && (
        <div className="app" style={{ padding: 0 }}>
          <div>
            <BeliefTimeline steps={asRecords} onPick={setI} selected={i} />
          </div>
          <div>
            <MetricsPanel steps={asRecords} />
            <PredictionLedger steps={asRecords} onPick={setI} selected={i} />
          </div>
        </div>
      )}

      {cur && (
        <div className="app" style={{ padding: 0, gridTemplateColumns: 'minmax(0,1fr) 400px' }}>
          <div className="panel">
            <div className="stage">
              <div className="roombar">
                <span>ROOM {cur.level}</span>
                <span className="muted">
                  action {cur.level_step} · button {cur.button}
                </span>
              </div>
              <Room
                level={LEVELS[cur.level - 1]}
                path={(cur.researcher.path ?? [cur.researcher.entity_before, cur.researcher.entity_after])}
                animToken={i}
                highlight={{ x: cur.researcher.entity_after.x, y: cur.researcher.entity_after.y }}
                celebrate={cur.level_complete}
              />
            </div>
          </div>
          <div>
            <div className="panel">
              <h2>What the agent said</h2>
              <div className="say">
                <span className="lbl">Hypothesis</span>
                <span className="val">{cur.hypothesis}</span>
              </div>
              <div className="say pred">
                <span className="lbl">Predicted</span>
                <span className="val">{cur.prediction}</span>
              </div>
              <div className="say actual">
                <span className="lbl">Actually happened</span>
                <span className="val">
                  {cur.researcher.blocked
                    ? 'nothing moved'
                    : `${cur.researcher.entity_before.x},${cur.researcher.entity_before.y} → ${cur.researcher.entity_after.x},${cur.researcher.entity_after.y}`}
                  {cur.researcher.auto_moved ? ` (carried ${cur.researcher.auto_moved})` : ''}
                  {cur.level_complete ? ' · room ended' : ''}
                </span>
              </div>
              {cur.contradiction && (
                <div className="say contra">
                  <span className="lbl">Contradiction reported</span>
                  <span className="val">{cur.contradiction}</span>
                </div>
              )}
            </div>

            <div className="panel researcher">
              <h2>Replay integrity</h2>
              {check?.incompatible ? (
                <p style={{ color: 'var(--gold)', margin: 0 }}>
                  ⚠ this recording does not fit the current engine — it was made before the
                  rooms or the controls changed, so it cannot be replayed. See
                  <span className="mono"> runs/archive-engine-v1/</span>.
                </p>
              ) : check?.same ? (
                <p style={{ color: 'var(--green)', margin: 0 }}>
                  ✓ engine reproduces this recorded step exactly
                </p>
              ) : (
                <p style={{ color: 'var(--rose)', margin: 0 }}>
                  ✗ engine and log disagree — recomputed{' '}
                  <span className="mono">{JSON.stringify(check?.recomputed.state)}</span>, log says{' '}
                  <span className="mono">{JSON.stringify(cur.researcher.entity_after)}</span>
                </p>
              )}
              <dl className="kv" style={{ marginTop: 10 }}>
                <dt>Rule set</dt>
                <dd style={{ color: cur.researcher.true_rules.slipperyEnabled ? 'var(--green)' : 'var(--rose)' }}>
                  {cur.researcher.true_rules.slipperyEnabled ? 'original' : 'changed'}
                </dd>
                <dt>Run config</dt>
                <dd className="mono">{JSON.stringify((header as any)?.config ?? {})}</dd>
              </dl>
            </div>

            <div className="panel">
              <h2>Memory the agent held when it chose</h2>
              <pre className="flatmem">
                {(cur as any).memory_in_prompt ?? (cur as any).memory_after ?? '(empty)'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
