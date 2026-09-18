import type { Observation } from '../engine/observation.ts';
import { MEMORY_BUDGET_CHARS, renderMemory, type Memory, type StrategyName } from './memory.ts';

/**
 * Prompt assembly.
 *
 * Every request is built from scratch out of (fixed instruction + current
 * observation + the memory store). There is no conversation history, no server
 * session, and no hidden state — so what a strategy "knows" is exactly what its
 * store holds, which is the whole point of the comparison. If old rules could
 * survive in a message history, a reset arm would not actually be reset and the
 * experiment would measure the model's context window instead of its memory.
 */

const COMMON = `You are controlling something inside an unfamiliar game.

Each turn you see the room as a grid of visual codes, you press exactly one
button (A, B, C or D), and then you see what happened.

Nobody has told you what the buttons do, what the different surfaces do, or what
makes a room end. You have to work that out from what you observe. When a room
does end, the result of your action will say so and you will find yourself in a
new room. Reaching later rooms is what you are here to do.

The rules of this world are usually stable, but they are not guaranteed to stay
that way.

Your memory is the only thing that persists from turn to turn. You do not get to
see your earlier messages — only the memory you wrote. If you want to keep
something, write it into memory.

Be willing to spend a press on a deliberate test when you are unsure. A press
that resolves an uncertainty is usually worth more than a press that acts on a
guess.`;

const FLAT_MEMORY = `Your memory is one block of free text. Replace it in full each turn: whatever
you return becomes your entire memory, so keep anything you still want.
You may rewrite, correct or delete anything you previously wrote.

Return "memory" as a single string, at most ${MEMORY_BUDGET_CHARS} characters.`;

const STRUCTURED_MEMORY = `Your memory is a list of separate entries. Replace the list in full each turn:
whatever you return becomes your entire memory, so keep anything you still
want. You may edit, restate or drop any individual entry.

Return "memory" as an array of objects with these fields:
  id             short stable identifier you choose, e.g. "btn_b"
  claim          what you believe, in one sentence
  conditions     when you believe it applies ("" if you think it is general)
  status         one of: hypothesis, confirmed, suspect, superseded
  supported_by   step numbers whose outcome agreed with this entry
  contradicted_by step numbers whose outcome disagreed with it
  depends_on     ids of other entries this one was built on top of

You decide what depends on what. Nothing checks these links for you.
The whole array must serialise to at most ${MEMORY_BUDGET_CHARS} characters.`;

const RESPONSE = `Reply with a single JSON object and nothing else:

{
  "button": "A" | "B" | "C" | "D",
  "hypothesis": "the one thing this press is meant to find out, in a sentence",
  "prediction": "the visible change you expect, or \\"unknown\\" if you cannot say",
  "memory": <as described above>,
  "contradiction": "what you just saw that conflicts with what you believed, or null"
}

"unknown" is a real answer for prediction. Do not invent confidence you do not
have. Keep hypothesis and prediction to one short sentence each.`;

export function systemPrompt(strategy: StrategyName): string {
  return [COMMON, strategy === 'flat' ? FLAT_MEMORY : STRUCTURED_MEMORY, RESPONSE].join('\n\n');
}

export function userPrompt(args: {
  observation: Observation;
  memory: Memory;
  stepNumber: number;
  memoryRejected: string | null;
  lastInvalid: string | null;
  /** what this agent itself predicted last turn, echoed back verbatim */
  lastPrediction: string | null;
}): string {
  const { observation, memory, stepNumber } = args;
  const mem = renderMemory(memory);
  // One grid row per line. Indenting the obvious way spends a line per cell,
  // which on a 9x9 room is hundreds of wasted tokens every turn on every arm.
  const flatGrid = {
    ...observation,
    grid: { ...observation.grid, cells: observation.grid.cells.map((r) => r.join(' ')) },
  };
  const obsText = JSON.stringify(flatGrid, null, 1);
  const parts = [`Step ${stepNumber}.`];
  // Echo the agent's own last prediction back to it.
  //
  // Without this the protocol asks for a contradiction report while withholding
  // the thing to contradict: the agent is shown what happened but not what it
  // said would happen, so it can only compare the two by having manually copied
  // its prediction into memory. That is a bookkeeping burden, it falls
  // differently on the two memory formats, and it confounds the very comparison
  // this study is built to make. This is the agent's own output being handed
  // back, so it reveals nothing about the world.
  if (args.lastPrediction)
    parts.push(
      `Before your last press you predicted: "${args.lastPrediction}"\n` +
        `Compare that with what actually happened below.`,
    );
  parts.push(
    `Your memory right now (${mem.length}/${MEMORY_BUDGET_CHARS} characters):`,
    mem.trim() ? mem : '(empty — this is the first thing you have seen)',
    `What you can see:`,
    obsText,
  );
  if (args.memoryRejected) parts.push(`Note: ${args.memoryRejected}`);
  if (args.lastInvalid)
    parts.push(
      `Note: your previous reply could not be used (${args.lastInvalid}). No button was pressed and nothing in the room changed.`,
    );
  return parts.join('\n\n');
}
