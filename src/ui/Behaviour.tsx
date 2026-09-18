import { useMemo, useState } from 'react';
import {
  beliefTracks,
  computeMetrics,
  verdictOf,
  RECOVERY_STREAK,
  type StepRecord,
} from '../metrics.ts';

/**
 * Views for reading what the agent is doing, rather than what it wrote.
 *
 * The raw log is unreadable at speed: memory is a wall of JSON that changes a
 * little every turn, so the one moment that matters — a belief being demoted —
 * looks exactly like every other turn. These three views exist to make that
 * moment jump out: what it predicted against what happened, every belief's
 * status over time, and the handful of numbers that can be computed honestly.
 */

const STATUS_COLOR: Record<string, string> = {
  hypothesis: 'var(--violet)',
  confirmed: 'var(--green)',
  suspect: 'var(--gold)',
  superseded: '#5a4f62',
};

function pos(p: { x: number; y: number } | null | undefined) {
  return p ? `${p.x},${p.y}` : '—';
}

/** Step-by-step: what it committed to, and whether the world agreed. */
export function PredictionLedger({
  steps,
  onPick,
  selected,
}: {
  steps: StepRecord[];
  onPick?: (i: number) => void;
  selected?: number;
}) {
  if (!steps.length)
    return (
      <div className="panel">
        <h2>Predictions</h2>
        <p style={{ color: 'var(--dim)', margin: 0 }}>Nothing yet.</p>
      </div>
    );

  return (
    <div className="panel">
      <h2>Predictions — what it expected vs what happened</h2>
      <div className="ledger">
        <div className="lrow lhead">
          <span>#</span>
          <span>room</span>
          <span>btn</span>
          <span>said</span>
          <span>was</span>
          <span />
        </div>
        {steps.map((s, i) => {
          const v = verdictOf(s);
          const changed = s.researcher.intervention_applied;
          const firstAfter =
            changed && (i === 0 || !steps[i - 1].researcher.intervention_applied);
          return (
            <div key={i}>
              {firstAfter && (
                <div className="rulebreak">rule changed — striped surface no longer carries</div>
              )}
              <div
                className={`lrow ${v === true ? 'hit' : v === false ? 'miss' : 'abstain'} ${
                  selected === i ? 'sel' : ''
                }`}
                onClick={() => onPick?.(i)}
                title={s.hypothesis}
              >
                <span className="dim">{s.global_step}</span>
                <span className="dim">{s.level}</span>
                <span className="btn">{s.button}</span>
                <span>{pos(s.predicted_position)}</span>
                <span>{pos(s.researcher.entity_after)}</span>
                <span>
                  {v === true ? '✓' : v === false ? '✗' : '·'}
                  {s.level_complete ? ' ★' : ''}
                  {s.researcher.discriminating_under_rule_change ? ' ⌁' : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="legend">
        ✓ predicted correctly · ✗ wrong · · declined to predict · ★ room ended ·
        ⌁ this press would look different under the other rule set
      </p>
    </div>
  );
}

/** One row per belief, one cell per step, coloured by status. */
export function BeliefTimeline({
  steps,
  onPick,
  selected,
}: {
  steps: StepRecord[];
  onPick?: (i: number) => void;
  selected?: number;
}) {
  const tracks = useMemo(() => beliefTracks(steps), [steps]);
  const [hover, setHover] = useState<string | null>(null);

  if (!tracks.length)
    return (
      <div className="panel">
        <h2>Beliefs over time</h2>
        <p style={{ color: 'var(--dim)', margin: 0 }}>
          Available for structured memory once the agent has written some beliefs.
        </p>
      </div>
    );

  const changeAt = steps.findIndex((s) => s.researcher.intervention_applied);

  return (
    <div className="panel">
      <h2>Beliefs over time — watch for a row that changes colour</h2>
      <div className="tl">
        {tracks.map((t) => (
          <div className="tlrow" key={t.id} onMouseEnter={() => setHover(t.id)}>
            <span
              className="tlname"
              style={{ paddingLeft: t.depends_on.length ? 12 : 0 }}
              title={`${t.claim}${t.depends_on.length ? `\n\nbuilt on: ${t.depends_on.join(', ')}` : ''}`}
            >
              {t.depends_on.length ? '└ ' : ''}
              {t.id}
            </span>
            <span className="tlcells">
              {t.status.map((st, i) => (
                <i
                  key={i}
                  onClick={() => onPick?.(i)}
                  className={`tlcell ${selected === i ? 'sel' : ''} ${
                    changeAt >= 0 && i === changeAt ? 'atchange' : ''
                  }`}
                  style={{ background: st ? STATUS_COLOR[st] ?? '#666' : 'transparent' }}
                  title={st ? `step ${steps[i].global_step}: ${st}` : 'not written yet'}
                />
              ))}
            </span>
          </div>
        ))}
      </div>
      {hover && (
        <p className="legend" style={{ minHeight: 30 }}>
          <b>{hover}</b> — {tracks.find((t) => t.id === hover)?.claim}
        </p>
      )}
      <p className="legend">
        {Object.entries(STATUS_COLOR).map(([k, c]) => (
          <span key={k} style={{ marginRight: 10 }}>
            <i className="swatch" style={{ background: c }} /> {k}
          </span>
        ))}
        {changeAt >= 0 && <span style={{ color: 'var(--rose)' }}>│ = the rule changed here</span>}
      </p>
    </div>
  );
}

/** The numbers that can be computed without reading any prose. */
export function MetricsPanel({ steps }: { steps: StepRecord[] }) {
  const m = useMemo(() => computeMetrics(steps), [steps]);
  const pct = m.accuracy === null ? '—' : `${Math.round(m.accuracy * 100)}%`;

  const after = m.interventionAtStep !== null;
  return (
    <div className="panel">
      <h2>Measured</h2>
      <dl className="kv">
        <dt>Actions</dt>
        <dd>{m.totalActions}</dd>
        <dt>Rooms solved</dt>
        <dd>{m.roomsSolved}</dd>
        <dt>Prediction accuracy</dt>
        <dd>
          {pct}{' '}
          <span style={{ color: 'var(--dim)' }}>
            ({m.predictionsCorrect}/{m.predictionsCommitted} committed,{' '}
            {m.predictionsDeclined} declined)
          </span>
        </dd>
      </dl>

      <h2 style={{ marginTop: 14 }}>After the rule changed</h2>
      {!after ? (
        <p style={{ color: 'var(--dim)', margin: 0 }}>Nothing has changed yet in this run.</p>
      ) : (
        <>
          <dl className="kv">
            <dt>Changed at step</dt>
            <dd>{m.interventionAtStep}</dd>
            <dt title="the first press whose outcome differs between the old and new rules">
              First telling press
            </dt>
            <dd>{m.firstTellingStep ?? 'not yet'}</dd>
            <dt>First correct prediction</dt>
            <dd>{m.firstCorrectAfterChange ?? 'not yet'}</dd>
            <dt>First room solved</dt>
            <dd>{m.firstSuccessAfterChange ?? 'not yet'}</dd>
            <dt title={`${RECOVERY_STREAK} committed correct predictions in a row`}>
              Recovered
            </dt>
            <dd style={{ color: m.recoveredAtStep ? 'var(--green)' : 'var(--gold)' }}>
              {m.recoveredAtStep ? `step ${m.recoveredAtStep}` : 'not yet'}
            </dd>
            <dt title="telling presses made while still predicting wrongly">
              Missed chances
            </dt>
            <dd>{m.tellingPressesBeforeRecovery}</dd>
          </dl>
          {m.demotedAfterChange.length > 0 && (
            <p className="legend">
              Demoted after the change: <b>{m.demotedAfterChange.join(', ')}</b>. Whether that
              was the right belief to doubt is for you to judge — nothing here reads the claims.
            </p>
          )}
          <p className="legend">
            Recovery means {RECOVERY_STREAK} committed correct predictions in a row, fixed before
            any run. A first success is not a recovery and is listed separately.
          </p>
        </>
      )}
    </div>
  );
}
