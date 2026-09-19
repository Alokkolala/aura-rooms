import { Room } from './Room.tsx';
import { WirePanel } from './Wire.tsx';
import { LEVELS } from '../engine/levels.ts';
import { renderMemory } from '../agent/memory.ts';
import { computeMetrics } from '../metrics.ts';
import type { Condition, RunState } from '../runner.ts';
import type { StrategyName } from '../agent/memory.ts';

/**
 * One page for driving an agent and watching everything at once.
 *
 * The other tabs are each built for one job — play the rooms, read the beliefs,
 * read the wire. That is the right shape for analysis afterwards and the wrong
 * shape for the hour you spend pointing a new model at the thing and finding
 * out whether it works at all. During that hour the questions are always the
 * same four, and answering them meant three tabs and a terminal:
 *
 *   is it connected and to what   is it moving or stuck   what did it just say
 *   and is it failing on reasoning or on JSON
 *
 * So: subject and model at the top, controls next to them, the room and what it
 * just did on the left, the raw wire on the right, nothing hidden behind a
 * click that you would want during a run.
 */

export interface ConsoleConfig {
  model: string;
  strategy: StrategyName;
  condition: Condition;
  budget: number;
}

export function AgentConsole({
  s,
  subject,
  hasKey,
  config,
  onConfig,
  locked,
  busy,
  onStart,
  onPause,
  onStep,
  onRestart,
  onExport,
}: {
  s: RunState;
  /** the server's own label, e.g. "openrouter.ai - anthropic/claude-sonnet-5" */
  subject: string;
  hasKey: boolean;
  config: ConsoleConfig;
  onConfig: (c: ConsoleConfig) => void;
  locked: boolean;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onStep: () => void;
  onRestart: () => void;
  onExport: () => void;
}) {
  const level = LEVELS[s.levelIndex];
  const m = computeMetrics(s.records);
  const calls = s.transcript.length;
  const rejected = s.transcript.filter((e) => e.status === 'rejected').length;
  const errors = s.transcript.filter((e) => e.status === 'error').length;
  const tools = s.transcript.reduce((a, e) => a + (e.toolUses ?? 0), 0);
  const tokens = s.usage.input + s.usage.output;
  const last = s.lastReply;

  // The single most useful diagnostic during a first run, and the one that is
  // invisible everywhere else: calls that produced no action at all. A model
  // that cannot emit the JSON looks exactly like a model that cannot solve the
  // room, right up until you read the raw replies.
  const stuck = calls > 3 && rejected / calls > 0.4;

  return (
    <div className="console">
      <div className="panel cbar">
        <div className="crow">
          <span className="clbl">Subject</span>
          <span className={`cpill ${hasKey ? 'ok' : 'bad'}`}>
            {hasKey ? subject : 'no credentials on the server'}
          </span>
          {locked && <span className="cpill lock">locked for this run</span>}
        </div>

        <div className="crow">
          <span className="clbl">Model</span>
          <input
            className="cinput"
            value={config.model}
            disabled={locked}
            placeholder="server default — e.g. anthropic/claude-sonnet-5"
            onChange={(e) => onConfig({ ...config, model: e.target.value })}
            spellCheck={false}
          />
          <select
            className="csel"
            value={config.strategy}
            disabled={locked}
            onChange={(e) => onConfig({ ...config, strategy: e.target.value as StrategyName })}
          >
            <option value="structured">structured memory</option>
            <option value="flat">flat memory</option>
          </select>
          <select
            className="csel"
            value={config.condition}
            disabled={locked}
            onChange={(e) => onConfig({ ...config, condition: e.target.value as Condition })}
          >
            <option value="hidden">hidden change</option>
            <option value="notified">announced change</option>
            <option value="stable">stable world (control)</option>
          </select>
          <input
            className="cnum"
            type="number"
            min={5}
            max={99}
            value={config.budget}
            disabled={locked}
            onChange={(e) => onConfig({ ...config, budget: Number(e.target.value) || 25 })}
          />
          <span className="clbl">actions / room</span>
        </div>

        <div className="crow">
          <button className="cbtn go" onClick={onStart} disabled={!hasKey || busy || s.finished}>
            ▶ Start
          </button>
          <button className="cbtn" onClick={onPause} disabled={!s.running}>
            ❚❚ Pause
          </button>
          <button className="cbtn" onClick={onStep} disabled={!hasKey || busy || s.finished}>
            ⤳ One step
          </button>
          <button className="cbtn" onClick={onRestart} disabled={busy}>
            ↺ Restart empty
          </button>
          <button className="cbtn" onClick={onExport} disabled={!s.records.length}>
            ⭳ Export
          </button>
          <span className="spacer" />
          <span className="cstat">
            room <b>{s.levelIndex + 1}</b>/8 · step <b>{s.globalStep}</b> · solved{' '}
            <b>{s.levelsCompleted}</b> · deaths <b>{s.deaths}</b>
          </span>
        </div>

        <div className="crow cstats">
          <span>
            calls <b>{calls}</b>
          </span>
          <span className={rejected ? 'warn' : ''}>
            pressed nothing <b>{rejected}</b>
          </span>
          <span className={errors ? 'bad' : ''}>
            provider errors <b>{errors}</b>
          </span>
          {tools > 0 && (
            <span className="bad">
              TOOL CALLS <b>{tools}</b> — seal broken
            </span>
          )}
          <span>
            tokens <b>{tokens.toLocaleString()}</b>
          </span>
          <span>
            accuracy <b>{m.accuracy === null ? '—' : `${Math.round(m.accuracy * 100)}%`}</b>
          </span>
          {s.interventionAtStep !== null && (
            <span className={m.recovered ? 'good' : 'warn'}>
              rule changed at <b>{s.interventionAtStep}</b> ·{' '}
              {m.recovered ? `recovered at ${m.recoveredAtStep}` : 'not recovered'}
            </span>
          )}
        </div>

        {!hasKey && (
          <p className="cnote bad">
            Put <code>OPENROUTER_API_KEY=sk-or-...</code> in a <code>.env</code> file at the repo
            root and restart <code>npm run dev</code>. The file is gitignored and the key is read
            server-side only.
          </p>
        )}
        {stuck && (
          <p className="cnote warn">
            {rejected} of {calls} replies could not be used, so they pressed nothing. This model is
            failing on the JSON, not on the rooms — open a ✗ row on the right and read what it
            actually sent.
          </p>
        )}
        {s.error && <p className="cnote bad">Provider error — {s.error}</p>}
      </div>

      <div className="ccol">
        <div className="panel">
          <div className="roombar">
            <span>
              ROOM {s.levelIndex + 1} / 8
              <span className="muted">
                {' '}
                {s.levelStep} / {s.config.actionBudgetPerLevel} actions
              </span>
            </span>
          </div>
          <Room
            level={level}
            path={s.path}
            animToken={s.animToken}
            highlight={{ x: s.entity.x, y: s.entity.y }}
            celebrate={s.lastAction?.room_changed ?? false}
          />
        </div>

        <div className="panel">
          <h2>What it just did</h2>
          <div className="say">
            <span className="lbl">Button</span>
            <span className="val pix" style={{ fontSize: 16, color: 'var(--teal)' }}>
              {s.lastAction?.button ?? '—'}
            </span>
          </div>
          <div className="say">
            <span className="lbl">Testing</span>
            <span className={`val ${last?.hypothesis ? '' : 'quiet'}`}>
              {last?.hypothesis || 'nothing yet'}
            </span>
          </div>
          <div className="say">
            <span className="lbl">Expected</span>
            <span className={`val ${last?.prediction ? '' : 'quiet'}`}>
              {last?.prediction || '—'}
              {last && last.verdict !== null && (
                <b style={{ color: last.verdict ? 'var(--green)' : 'var(--rose)' }}>
                  {last.verdict ? '  ✓ right' : '  ✗ wrong'}
                </b>
              )}
            </span>
          </div>
          <div className="say">
            <span className="lbl">Flagged</span>
            <span className={`val ${last?.contradiction ? '' : 'quiet'}`}>
              {last?.contradiction || 'no contradiction reported'}
            </span>
          </div>
        </div>

        <div className="panel">
          <h2>Memory — {s.config.strategy}</h2>
          <pre className="cmem">{renderMemory(s.memory) || '(empty)'}</pre>
        </div>
      </div>

      <div className="ccol">
        <WirePanel s={s} />
      </div>
    </div>
  );
}
