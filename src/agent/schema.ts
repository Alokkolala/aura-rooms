import type { Button } from '../engine/types.ts';
import type { Memory, StrategyName, StructuredEntry } from './memory.ts';

/**
 * What the agent commits to before each press.
 *
 * Four independent, falsifiable claims about what a person would see happen.
 * Each may be null, which records "I am not saying" and is never scored as
 * wrong — an agent that admits it does not know should not be punished for it.
 *
 * WHY THESE FOUR AND NOT AN EVENT LABEL. The obvious design is a single enum:
 * move / blocked / deflected / death / room_complete. It is easier to read and
 * it is wrong twice over. First, the labels name causes, and putting them in
 * the schema tells a room-1 agent that dying and being thrown across the room
 * are things this world does — before it has met either, and before the rooms
 * that introduce them. Second, a single label forces an arbitrary precedence
 * when a press does two things at once, so the agent is scored partly on
 * guessing the labelling convention rather than on understanding the world.
 *
 * These four are each a yes/no a person could read off the screen, they
 * compose freely, and they are compared with `===`. That is what makes "was the
 * agent right" arithmetic rather than an opinion, and it is what every
 * downstream measurement — the recovery criterion above all — is built on.
 */
export interface Prediction {
  /** where the entity will be standing once everything has settled */
  end_position: { x: number; y: number } | null;
  /** whether it will be standing anywhere other than where it is now */
  position_changed: boolean | null;
  /** whether it will be standing on the square this room began on */
  returned_to_start: boolean | null;
  /** whether the next turn will be in a different room */
  room_changed: boolean | null;
}

export const PREDICTION_FIELDS = [
  'end_position',
  'position_changed',
  'returned_to_start',
  'room_changed',
] as const;

export type PredictionField = (typeof PREDICTION_FIELDS)[number];

export const EMPTY_PREDICTION: Prediction = {
  end_position: null,
  position_changed: null,
  returned_to_start: null,
  room_changed: null,
};

export interface AgentReply {
  button: Button;
  hypothesis: string;
  prediction: string;
  expect: Prediction;
  memory: Memory;
  contradiction: string | null;
}

export type Validation =
  | { ok: true; reply: AgentReply }
  | { ok: false; error: string };

const BUTTONS = new Set(['A', 'B', 'C', 'D']);
const STATUSES = new Set(['hypothesis', 'confirmed', 'suspect', 'superseded']);

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  return v.slice(0, max);
}

function intArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.filter((n): n is number => Number.isInteger(n)).slice(0, 24);
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === 'string').slice(0, 12);
}

/** A tri-state field: true, false, or "not saying". Anything else is an error. */
function tri(v: unknown, field: string): { ok: true; value: boolean | null } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: null };
  if (typeof v === 'boolean') return { ok: true, value: v };
  return { ok: false, error: `expect.${field} must be true, false or null` };
}

function parsePrediction(raw: unknown): { ok: true; value: Prediction } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: { ...EMPTY_PREDICTION } };
  if (typeof raw !== 'object') return { ok: false, error: 'expect must be an object or null' };
  const o = raw as Record<string, unknown>;

  let end: { x: number; y: number } | null = null;
  const ep = o.end_position;
  if (ep !== undefined && ep !== null) {
    if (typeof ep !== 'object') return { ok: false, error: 'expect.end_position must be {x,y} integers or null' };
    const p = ep as Record<string, unknown>;
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y))
      return { ok: false, error: 'expect.end_position must be {x,y} integers or null' };
    end = { x: p.x as number, y: p.y as number };
  }

  const moved = tri(o.position_changed, 'position_changed');
  if (!moved.ok) return moved;
  const back = tri(o.returned_to_start, 'returned_to_start');
  if (!back.ok) return back;
  const room = tri(o.room_changed, 'room_changed');
  if (!room.ok) return room;

  return {
    ok: true,
    value: {
      end_position: end,
      position_changed: moved.value,
      returned_to_start: back.value,
      room_changed: room.value,
    },
  };
}

/**
 * Strict validation of one model response.
 *
 * A malformed reply performs NO action. It must never be repaired into a guess
 * or replaced by a random button — that would silently convert a model failure
 * into a world interaction and contaminate every downstream measurement.
 *
 * An absent or null `expect` is NOT malformed: it is the agent declining on all
 * four fields, which is a legitimate answer and is recorded as such.
 */
export function validate(raw: unknown, strategy: StrategyName): Validation {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'response was not a JSON object' };
  const o = raw as Record<string, unknown>;

  const button = typeof o.button === 'string' ? o.button.trim().toUpperCase() : '';
  if (!BUTTONS.has(button)) return { ok: false, error: `button must be one of A B C D, got ${JSON.stringify(o.button)}` };

  const hypothesis = str(o.hypothesis, 400);
  if (hypothesis === null) return { ok: false, error: 'hypothesis must be a string' };
  const prediction = str(o.prediction, 400);
  if (prediction === null) return { ok: false, error: 'prediction must be a string' };

  const expect = parsePrediction(o.expect);
  if (!expect.ok) return { ok: false, error: expect.error };

  let memory: Memory;
  if (strategy === 'native') {
    memory = { kind: 'native' }; // nothing is asked for, and nothing sent is kept
  } else if (strategy === 'flat') {
    const text = str(o.memory, 8000);
    if (text === null) return { ok: false, error: 'memory must be a string for this strategy' };
    memory = { kind: 'flat', text };
  } else {
    if (!Array.isArray(o.memory)) return { ok: false, error: 'memory must be an array of entries for this strategy' };
    const entries: StructuredEntry[] = [];
    for (const [i, e] of (o.memory as unknown[]).slice(0, 40).entries()) {
      if (typeof e !== 'object' || e === null) return { ok: false, error: `memory[${i}] is not an object` };
      const r = e as Record<string, unknown>;
      const id = str(r.id, 40);
      const claim = str(r.claim, 300);
      if (!id || !claim) return { ok: false, error: `memory[${i}] needs a non-empty id and claim` };
      const status = typeof r.status === 'string' ? r.status : '';
      if (!STATUSES.has(status)) return { ok: false, error: `memory[${i}].status must be one of hypothesis confirmed suspect superseded` };
      entries.push({
        id,
        claim,
        conditions: str(r.conditions, 300) ?? '',
        status: status as StructuredEntry['status'],
        supported_by: intArray(r.supported_by),
        contradicted_by: intArray(r.contradicted_by),
        depends_on: strArray(r.depends_on),
      });
    }
    memory = { kind: 'structured', entries };
  }

  return {
    ok: true,
    reply: {
      button: button as Button,
      hypothesis,
      prediction,
      expect: expect.value,
      memory,
      contradiction: str(o.contradiction, 400) || null,
    },
  };
}

/** Pull the first balanced JSON object out of a response, tolerating fences. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('no JSON object in response');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('unterminated JSON object in response');
}
