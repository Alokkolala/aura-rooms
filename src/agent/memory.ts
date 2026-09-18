/**
 * The two memory strategies under comparison.
 *
 * Both get the same model, the same observations, the same action budget, the
 * same character budget, the same response schema, and the same permission to
 * rewrite anything they previously wrote. The flat store is not a strawman: if
 * it loses, it has to lose on organisation, not on being forbidden to correct
 * itself.
 */

export type StrategyName = 'flat' | 'structured';

export type EntryStatus = 'hypothesis' | 'confirmed' | 'suspect' | 'superseded';

export interface StructuredEntry {
  id: string;
  claim: string;
  conditions: string;
  status: EntryStatus;
  supported_by: number[];
  contradicted_by: number[];
  depends_on: string[];
}

export type Memory =
  | { kind: 'flat'; text: string }
  | { kind: 'structured'; entries: StructuredEntry[] };

/**
 * The same limit for both strategies — but note what "the same" buys.
 *
 * A structured store pays for field names and punctuation on every entry; a
 * flat store expresses the same knowledge in far fewer characters. At 2400 a
 * fully-learned structured memory measured 2302 and had room for nothing more,
 * while the flat equivalent sat near 900. An equal number is therefore NOT an
 * equal capacity, and a budget that binds on one arm and not the other is a
 * second independent variable smuggled in as a constant.
 *
 * So the MVP sets it high enough not to bind on either arm. How the two
 * strategies behave UNDER capacity pressure is a real question, but it is a
 * different experiment and needs its own design.
 */
export const MEMORY_BUDGET_CHARS = 6000;

export function emptyMemory(s: StrategyName): Memory {
  return s === 'flat' ? { kind: 'flat', text: '' } : { kind: 'structured', entries: [] };
}

/**
 * Render a memory store exactly as the agent will see it.
 *
 * Structured memory is one entry per line, each entry compact JSON. Indenting
 * it the obvious way put every `supported_by` integer on its own line, which
 * inflated a fully-populated store to roughly 2.3x its own content: at an equal
 * character budget the structured arm would have carried far less knowledge
 * than the flat one, purely because of whitespace. That is a confound in the
 * instrument, not a fact about memory. The budget is measured against this same
 * string, so what is counted is exactly what is sent.
 */
export function renderMemory(m: Memory): string {
  if (m.kind === 'flat') return m.text;
  if (!m.entries.length) return '[]';
  return `[\n${m.entries.map((e) => ` ${JSON.stringify(e)}`).join(',\n')}\n]`;
}

export function memorySize(m: Memory): number {
  return renderMemory(m).length;
}

/**
 * Apply a proposed memory update.
 *
 * An over-budget update is REJECTED rather than silently trimmed, and the agent
 * is told on its next turn. Trimming would quietly delete knowledge the agent
 * believes it still has, which would show up in the results as a memory failure
 * that the harness actually caused.
 */
export function applyMemory(
  prev: Memory,
  proposed: Memory,
): { memory: Memory; rejected: string | null } {
  const size = memorySize(proposed);
  if (size > MEMORY_BUDGET_CHARS)
    return {
      memory: prev,
      rejected:
        `Your last memory update was ${size} characters, over the ${MEMORY_BUDGET_CHARS} limit. ` +
        `It was discarded and your previous memory kept. Write something shorter.`,
    };
  return { memory: proposed, rejected: null };
}
