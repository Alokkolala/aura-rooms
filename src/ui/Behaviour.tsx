import { useMemo, useState } from 'react';
import {
  beliefTracks,
  computeMetrics,
  verdictOf,
  RECOVERY_CRITERION,
  type StepRecord,
} from '../metrics.ts';
import { PREDICTION_FIELDS, type Prediction } from '../agent/schema.ts';

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

/**
 * One line for four independent claims: the end square, then a letter per
 * remaining field — m(oved), s(tart), r(oom) — upper case for "yes", lower for
 * "no", absent when the agent declined. Compact enough to scan a whole run.
 */
function saidShort(p: Prediction | null | undefined) {
  if (!p) return '—';
  const flags = PREDICTION_FIELDS.filter((f) => f !== 'end_position')
    .map((f) => {
      const v = p[f] as boolean | null;
      if (v === null || v === undefined) return '';
      const letter = f === 'position_changed' ? 'm' : f === 'returned_to_start' ? 's' : 'r';
      return v ? letter.toUpperCase() : letter;
    })
    .join('');
  const end = p.end_position ? `${p.end_position.x},${p.end_position.y}` : '·';
  return flags ? `${end} ${flags}` : end;
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
                <div className="rulebreak">
                  rule changed — the two marked surfaces have traded meanings
                </div>
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
                <span>{saidShort(s.expect)}</span>
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
        said = end square, then m/s/r for position changed, back on the starting square, room
        changed — capital for yes, absent when it declined. ✓ every committed field right · ✗ at
        least one wrong · · committed to nothing · ★ room ended · ⌁ this press would look
        different under the other rule set
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
        <dt title="one committed field is one falsifiable claim">Prediction accuracy</dt>
        <dd>
          {pct}{' '}
          <span style={{ color: 'var(--dim)' }}>
            ({m.fieldsCorrect}/{m.fieldsCommitted} fields, {m.predictionsDeclined} presses
            committed to nothing)
          </span>
        </dd>
        {m.hazardContacts.length > 0 && (
          <>
            <dt title="presses that put the entity on the surface that ends the run">
              Hazard contacts
            </dt>
            <dd>
              {m.hazardContacts
                .map((h) => `r${h.level}: ${h.presses}${h.deaths ? ` (${h.deaths} fatal)` : ''}`)
                .join(' · ')}
            </dd>
          </>
        )}
      </dl>

      <h2 style={{ marginTop: 14 }}>After the rule changed</h2>
      {!after ? (
        <p style={{ color: 'var(--dim)', margin: 0 }}>Nothing has changed yet in this run.</p>
      ) : (
        <>
          <dl className="kv">
            <dt>Changed at step</dt>
            <dd>{m.interventionAtStep}</dd>
            <dt title="the first press whose outcome differs between the old and new rules — before this, there was nothing to notice">
              First evidence
            </dt>
            <dd>{m.firstEvidenceStep ?? 'not yet'}</dd>
            <dt title="R1 — first correct prediction on a field the change actually altered">
              First revised prediction
            </dt>
            <dd>{m.firstRevisedPredictionStep ?? 'not yet'}</dd>
            <dt title="strict R1 — first telling press on which every altered field the agent committed to was right">
              First strictly revised prediction
            </dt>
            <dd>{m.firstStrictRevisedPredictionStep ?? 'not yet'}</dd>
            <dt title="R1 minus first evidence: presses spent with the evidence already in hand">
              Detection delay
            </dt>
            <dd>{m.detectionDelay ?? '—'}</dd>
            <dt title="R2 — first room finished after the change">Room finished after</dt>
            <dd>{m.postChangeCompletionStep ?? 'not yet'}</dd>
            <dt title={RECOVERY_CRITERION}>Recovered</dt>
            <dd style={{ color: m.recovered ? 'var(--green)' : 'var(--gold)' }}>
              {m.recovered ? `step ${m.recoveredAtStep}` : 'not yet'}
              {m.recoveredStrict ? ` · strict at ${m.recoveredStrictAtStep}` : ' · strict not yet'}
            </dd>
            <dt title="a room finished after the change on a later level than the one recovery was earned in — a harder bar than recovery">
              Transfer
            </dt>
            <dd style={{ color: m.transferSucceeded ? 'var(--green)' : undefined }}>
              {m.transferStep ? `step ${m.transferStep}` : 'not yet'}
            </dd>
            <dt title="committed predictions on altered fields that the world contradicted">
              Violations on altered fields
            </dt>
            <dd>{m.ruleRelevantViolations}</dd>
            <dt title="of those, the ones that were exactly what the dead rule predicted">
              Stale-rule predictions
            </dt>
            <dd>{m.staleRulePredictions}</dd>
            <dt title="presses onto the surface that used to end rooms">Stale-rule actions</dt>
            <dd>
              {m.staleRuleActions}
              {m.staleRuleDeaths ? ` (${m.staleRuleDeaths} fatal)` : ''}
            </dd>
            <dt title="accuracy on fields the change did NOT alter, before minus after">
              Collateral drop
            </dt>
            <dd>{m.collateralDrop === null ? '—' : `${Math.round(m.collateralDrop * 100)}pp`}</dd>
          </dl>
          {m.changes.slice(1).map((c) => (
            <dl className="kv" key={c.index} style={{ marginTop: 8 }}>
              <dt style={{ color: 'var(--gold)' }}>
                Change {c.index} · step {c.atStep} · {c.rulesAfter.swapped ? 'swapped' : 'back to original'}
              </dt>
              <dd />
              <dt>First evidence</dt>
              <dd>{c.firstEvidenceStep ?? 'not yet'}</dd>
              <dt>First revised prediction</dt>
              <dd>{c.firstRevisedPredictionStep ?? 'not yet'}</dd>
              <dt>Detection delay</dt>
              <dd>{c.detectionDelay ?? '—'}</dd>
              <dt>Room finished after</dt>
              <dd>{c.postChangeCompletionStep ?? 'not yet'}</dd>
              <dt>Recovered</dt>
              <dd style={{ color: c.recovered ? 'var(--green)' : 'var(--gold)' }}>
                {c.recovered ? `step ${c.recoveredAtStep}` : 'not yet'}
                {c.recoveredStrict ? ` · strict at ${c.recoveredStrictAtStep}` : ' · strict not yet'}
              </dd>
              <dt>Transfer</dt>
              <dd style={{ color: c.transferSucceeded ? 'var(--green)' : undefined }}>
                {c.transferStep ? `step ${c.transferStep}` : 'not yet'}
              </dd>
              <dt>Stale-rule actions</dt>
              <dd>
                {c.staleRuleActions}
                {c.staleRuleDeaths ? ` (${c.staleRuleDeaths} fatal)` : ''}
              </dd>
            </dl>
          ))}
          {m.demotedAfterChange.length > 0 && (
            <p className="legend">
              Demoted after the change: <b>{m.demotedAfterChange.join(', ')}</b>. Whether that
              was the right belief to doubt is for you to judge — nothing here reads the claims.
            </p>
          )}
          <p className="legend">
            Recovery means {RECOVERY_CRITERION}, fixed before any run. Predicting an ordinary move
            correctly cannot contribute to it, however many times in a row.
          </p>
        </>
      )}
    </div>
  );
}
