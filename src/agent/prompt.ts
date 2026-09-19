import type { Observation } from '../engine/observation.ts';
import { MEMORY_BUDGET_CHARS, renderMemory, type Memory, type StrategyName } from './memory.ts';
import type { Prediction } from './schema.ts';

/**
 * Prompt assembly.
 *
 * Every request is built from scratch out of (fixed instruction + current
 * observation + the memory store). There is no conversation history, no server
 * session, and no hidden state — so what a strategy "knows" is exactly what its
 * store holds, which is the whole point of the comparison. If old rules could
 * survive in a message history, a reset arm would not actually be reset and the
 * experiment would measure the model's context window instead of its memory.
 *
 * The `native` arm is the deliberate exception (E20): the subject's own
 * conversation IS its memory, so its turn carries no store and its instruction
 * says only that the conversation persists. It exists to measure exactly the
 * thing the sentence above guards against — what the memory protocol itself
 * costs — and is comparable with the stored arms only on the same subject.
 *
 * WHAT IS NOT HERE, AND WHY.
 *
 * The instruction used to end with "the rules of this world are usually stable,
 * but they are not guaranteed to stay that way". That sentence was in COMMON,
 * so every arm got it — including the hidden one, whose entire definition is
 * that it is NOT warned, and including the stable one, which has nothing to be
 * warned about. The announced condition is supposed to be the only arm that
 * learns a change has happened, and it learns it from one sentence attached to
 * one observation. A standing warning in the system prompt collapsed the
 * distinction the experiment exists to measure.
 *
 * It also used to say "be willing to spend a press on a deliberate test" and
 * "a press that resolves an uncertainty is usually worth more than a press that
 * acts on a guess". That is the experimental strategy being handed to the
 * subject. Whether an agent chooses to probe is part of what is under study.
 *
 * What is left is the machinery — how a turn works, what persists, what shape
 * the reply must take — and one line of objective.
 */

const COMMON = `You are controlling something inside an unfamiliar game.

Each turn you see the room as a grid of visual codes, you press exactly one
button (A, B, C or D), and then you see what happened.

Explore the environment and progress as far as you can.`;

const PERSIST_STORE = `Your memory is the only thing that persists from turn to turn. You do not get to
see your earlier messages — only the memory you wrote. If you want to keep
something, write it into memory.`;

// The native arm keeps its own conversation, so this is all that is true of it.
// Nothing about how to keep track of things: that is what is under study.
const PERSIST_NATIVE = `This conversation persists from turn to turn. There is no separate memory to
write.`;

const FLAT_MEMORY = `Your memory is one block of free text. Replace it in full each turn: whatever
you return becomes your entire memory, so keep anything you still want.
You may rewrite, correct or delete anything you previously wrote.

Return "memory" as a single string, at most ${MEMORY_BUDGET_CHARS} characters.`;

const STRUCTURED_MEMORY = `Your memory is a list of separate entries. Replace the list in full each turn:
whatever you return becomes your entire memory, so keep anything you still
want. You may edit, restate or drop any individual entry.

Return "memory" as an array of objects with these fields:
  id             short fixed identifier you choose, e.g. "btn_b"
  claim          what you believe, in one sentence
  conditions     when you believe it applies ("" if you think it is general)
  status         one of: hypothesis, confirmed, suspect, superseded
  supported_by   step numbers whose outcome agreed with this entry
  contradicted_by step numbers whose outcome disagreed with it
  depends_on     ids of other entries this one was built on top of

You decide what depends on what. Nothing checks these links for you.
The whole array must serialise to at most ${MEMORY_BUDGET_CHARS} characters.`;

const response = (withMemory: boolean) => `Reply with a single JSON object and nothing else:

{
  "button": "A" | "B" | "C" | "D",
  "hypothesis": "the one thing this press is meant to find out, in a sentence",
  "prediction": "what you expect to see, in a few words",
  "expect": {
    "end_position": {"x": <number>, "y": <number>},
    "position_changed": true | false,
    "returned_to_start": true | false,
    "room_changed": true | false
  },
${withMemory ? '  "memory": <as described above>,\n' : ''}  "contradiction": "what you just saw that conflicts with what you believed, or null"
}

The four fields inside "expect" describe what you think will be on the screen
after this press:

  end_position       the square the entity will be standing on once everything
                     has settled, counting from the top-left of the grid
  position_changed   whether it will be standing anywhere other than where it
                     is standing now
  returned_to_start  whether it will be standing on the square this room began
                     on
  room_changed       whether your next turn will be in a different room

Any of them may be null, and null means "I am not saying". A null is recorded
as declining, never as a wrong answer, so there is no reason to guess. Guessing
when you do not know is worse than saying so. Use "prediction" for anything
else you expect, in your own words.

Keep hypothesis and prediction to one short sentence each.`;

export function systemPrompt(strategy: StrategyName): string {
  if (strategy === 'native') return [COMMON, PERSIST_NATIVE, response(false)].join('\n\n');
  return [
    `${COMMON}\n\n${PERSIST_STORE}`,
    strategy === 'flat' ? FLAT_MEMORY : STRUCTURED_MEMORY,
    response(true),
  ].join('\n\n');
}

export function userPrompt(args: {
  observation: Observation;
  memory: Memory;
  stepNumber: number;
  memoryRejected: string | null;
  lastInvalid: string | null;
  /** what this agent itself said last turn, echoed back verbatim */
  lastPrediction: string | null;
  lastExpect?: Prediction | null;
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
  if (args.lastPrediction || args.lastExpect) {
    const said = [
      args.lastPrediction ? `"${args.lastPrediction}"` : null,
      args.lastExpect ? JSON.stringify(args.lastExpect) : null,
    ]
      .filter(Boolean)
      .join(' and ');
    parts.push(
      `Before your last press you predicted: ${said}\n` +
        `Compare that with what actually happened below.`,
    );
  }
  if (memory.kind !== 'native')
    parts.push(
      `Your memory right now (${mem.length}/${MEMORY_BUDGET_CHARS} characters):`,
      mem.trim() ? mem : '(empty — this is the first thing you have seen)',
    );
  parts.push(`What you can see:`, obsText);
  if (args.memoryRejected) parts.push(`Note: ${args.memoryRejected}`);
  if (args.lastInvalid)
    parts.push(
      `Note: your previous reply could not be used (${args.lastInvalid}). No button was pressed and nothing in the room changed.`,
    );
  return parts.join('\n\n');
}
