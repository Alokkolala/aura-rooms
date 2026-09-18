import type { Button } from '../engine/types.ts';
import type { Memory, StrategyName, StructuredEntry } from './memory.ts';

export interface AgentReply {
  button: Button;
  hypothesis: string;
  prediction: string;
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

/**
 * Strict validation of one model response.
 *
 * A malformed reply performs NO action. It must never be repaired into a guess
 * or replaced by a random button — that would silently convert a model failure
 * into a world interaction and contaminate every downstream measurement.
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

  let memory: Memory;
  if (strategy === 'flat') {
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
