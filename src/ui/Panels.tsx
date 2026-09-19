import { PAL } from './sprites.ts';
import type { Memory } from '../agent/memory.ts';
import type { Button } from '../engine/types.ts';
import type { FeedItem, RunState } from '../runner.ts';
import { INTERVENTIONS_BEFORE_LEVELS } from '../engine/levels.ts';

export function ButtonPad({
  onPress,
  last,
  disabled,
}: {
  onPress: (b: Button) => void;
  last: Button | null;
  disabled: boolean;
}) {
  return (
    <div className="pad">
      {(['A', 'B', 'C', 'D'] as Button[]).map((b) => (
        <button key={b} className={last === b ? 'hot' : ''} disabled={disabled} onClick={() => onPress(b)}>
          {b}
        </button>
      ))}
    </div>
  );
}

function MemoryView({ memory, changed }: { memory: Memory; changed: string[] }) {
  if (memory.kind === 'native')
    return <p style={{ color: 'var(--dim)' }}>(none — the subject keeps its own conversation)</p>;
  if (memory.kind === 'flat')
    return (
      <pre className={`flatmem ${changed.length ? 'changed' : ''}`}>
        {memory.text.trim() || '(empty)'}
      </pre>
    );
  if (!memory.entries.length) return <p style={{ color: 'var(--dim)' }}>(empty)</p>;
  return (
    <div className="entries">
      {memory.entries.map((e) => (
        <div key={e.id} className={`entry ${changed.includes(e.id) ? 'changed' : ''}`}>
          <span className="id">{e.id}</span>
          <span className={`pill ${e.status}`}>{e.status}</span>
          <div className="claim">{e.claim}</div>
          <div className="meta">
            {e.conditions ? `when: ${e.conditions} · ` : ''}
            +{e.supported_by.length} / −{e.contradicted_by.length}
            {e.depends_on.length ? ` · needs ${e.depends_on.join(', ')}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentPanel({ s }: { s: RunState }) {
  const la = s.lastAction;
  const actual = la
    ? la.before.x === la.after.x && la.before.y === la.after.y && la.before.marker === la.after.marker
      ? 'nothing visibly changed'
      : `${la.before.x},${la.before.y} ${la.before.marker} → ${la.after.x},${la.after.y} ${la.after.marker}` +
        (la.room_changed ? '  · room ended' : '')
    : null;

  return (
    <>
      <div className="panel">
        <h2>Agent</h2>
        <div className="say">
          <span className="lbl">Last button</span>
          <span className="val pix" style={{ fontSize: 16, color: 'var(--teal)' }}>
            {la?.button ?? '—'}
          </span>
        </div>
        <div className="say">
          <span className="lbl">Hypothesis being tested</span>
          <span className={`val ${s.lastReply?.hypothesis ? '' : 'quiet'}`}>
            {s.lastReply?.hypothesis || 'nothing yet'}
          </span>
        </div>
        <div className="say pred">
          <span className="lbl">Predicted</span>
          <span className={`val ${s.lastReply?.prediction ? '' : 'quiet'}`}>
            {s.lastReply?.prediction || '—'}
          </span>
        </div>
        <div className="say actual">
          <span className="lbl">Actually happened</span>
          <span className={`val ${actual ? '' : 'quiet'}`}>{actual || '—'}</span>
        </div>
        {s.lastReply?.contradiction && (
          <div className="say contra">
            <span className="lbl">Contradiction reported by the agent</span>
            <span className="val">{s.lastReply.contradiction}</span>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>
          Memory — {s.config.strategy}
          {s.inFlight ? ' · thinking…' : ''}
        </h2>
        <MemoryView memory={s.memory} changed={s.changedEntryIds} />
      </div>
    </>
  );
}

const TRUTH: Array<[string, string, string]> = [
  [PAL.floorA, 'tile_0 / tile_1', 'Two plain floors. Different look, identical behaviour.'],
  [PAL.solid, 'solid_tile', 'Blocks movement.'],
  [PAL.diagonalInk, 'diagonal_tile', 'Deflects travel 90° clockwise and carries it one more cell.'],
  [PAL.ringA, 'concentric_tile', 'ORIGINAL: ends the room. AFTER THE CHANGE: kills.'],
  [PAL.ringB, 'radial_tile', 'ORIGINAL: kills. AFTER THE CHANGE: ends the room.'],
];

export function ResearcherPanel({
  s,
  open,
  onToggle,
  model,
}: {
  s: RunState;
  open: boolean;
  onToggle: () => void;
  model: string;
}) {
  const changed = s.interventionAtStep !== null;
  return (
    <div className="panel researcher">
      <h2 style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }} onClick={onToggle}>
        <span>Researcher view</span>
        <span>{open ? '▾' : '▸'}</span>
      </h2>
      {open && (
        <>
          <div className="warnbar">Never included in the agent's observation.</div>

          <table className="truth">
            <tbody>
              <tr>
                <td colSpan={2} style={{ color: 'var(--gold)' }}>Buttons</td>
              </tr>
              <tr><td>A</td><td>move one cell up</td></tr>
              <tr><td>B</td><td>move one cell right</td></tr>
              <tr><td>C</td><td>move one cell down</td></tr>
              <tr><td>D</td><td>move one cell left</td></tr>
              <tr>
                <td colSpan={2} style={{ color: 'var(--dim)' }}>
                  Absolute directions; the labels are arbitrary. The entity's marker is
                  cosmetic and only shows the way it last travelled.
                </td>
              </tr>
              <tr>
                <td colSpan={2} style={{ color: 'var(--gold)', paddingTop: 8 }}>Surfaces</td>
              </tr>
              {TRUTH.map(([c, name, desc]) => (
                <tr key={name}>
                  <td>
                    <span className="swatch" style={{ background: c }} />
                    {name}
                  </td>
                  <td>
                    {desc}
                    {(name === 'concentric_tile' || name === 'radial_tile') && changed && (
                      <strong style={{ color: 'var(--rose)' }}> — SWAPPED</strong>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>Rule set</dt>
            <dd style={{ color: changed ? 'var(--rose)' : 'var(--green)' }}>
              {changed ? 'changed' : 'original'}
            </dd>
            <dt>Condition</dt>
            <dd>{s.config.condition}{s.config.manualIntervention ? ' (manual)' : ''}</dd>
            <dt>Strategy</dt>
            <dd>{s.config.strategy}</dd>
            <dt>Model</dt>
            <dd className="mono">{s.config.driver === 'llm' ? model : s.config.driver}</dd>
            <dt>Seed</dt>
            <dd>{s.config.seed}</dd>
            <dt>Action budget</dt>
            <dd>{s.levelStep} / {s.config.actionBudgetPerLevel} this room</dd>
            <dt>Rooms solved</dt>
            <dd>{s.levelsCompleted} / 8</dd>
            <dt>Model calls</dt>
            <dd>{s.usage.calls} · {s.usage.input + s.usage.output} tokens · {(s.usage.ms / 1000).toFixed(1)}s</dd>
            <dt>Invalid replies</dt>
            <dd style={{ color: s.invalidReplies ? 'var(--rose)' : undefined }}>{s.invalidReplies}</dd>
          </dl>

          <h2 style={{ marginTop: 12 }}>Change timeline</h2>
          <dl className="kv">
            <dt>Scheduled</dt>
            <dd>{s.config.condition === 'stable' ? 'none' : `before rooms ${INTERVENTIONS_BEFORE_LEVELS.join(' and ')}`}</dd>
            <dt>Applied at step</dt>
            <dd>{s.interventionAtStep ?? '—'}</dd>
            <dt>First telling action</dt>
            <dd title="first press whose outcome differs between the old and new rules">
              {s.firstDiscriminatingStep ?? 'not yet'}
            </dd>
            <dt>First success after</dt>
            <dd>{s.firstSuccessAfterChange ?? 'not yet'}</dd>
          </dl>
          <p style={{ color: 'var(--dim)', fontSize: 11, marginBottom: 0 }}>
            A first success is a first success, not a recovery. The agent cannot detect a change
            that has not yet shown itself, so the gap between "applied" and "first telling action"
            is dead time that belongs to the world, not to the agent.
          </p>
        </>
      )}
    </div>
  );
}

export function EventFeed({ feed }: { feed: FeedItem[] }) {
  return (
    <div className="panel">
      <h2>Events</h2>
      <div className="feed">
        {feed.length === 0 && <span style={{ color: 'var(--dim)' }}>nothing yet</span>}
        {feed.map((f, i) => (
          <div className={`row ${f.kind}`} key={`${f.step}-${i}`}>
            <span className="n">{f.step}</span>
            <span>
              <span className="t">
                {f.researcherOnly ? '◆ ' : ''}
                {f.text}
              </span>
              {f.detail && <div className="d">{f.detail}</div>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
