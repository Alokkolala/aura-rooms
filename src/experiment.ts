import type { StrategyName } from './agent/memory.ts';
import type { Condition } from './runner.ts';

/**
 * Experiments as declared plans rather than dropdown settings.
 *
 * Choosing arms by hand at run time means the design lives in whatever was
 * clicked, and a log cannot later say what was intended versus what happened to
 * be selected. A protocol names the arms, the repeats, and — the part that
 * matters most — what it is actually asking, in advance. If the question is not
 * written down before the run, it is far too easy to discover afterwards that
 * the run answered a different one.
 */

export interface Arm {
  strategy: StrategyName;
  condition: Condition;
}

export interface Protocol {
  id: string;
  title: string;
  /** The question, in one sentence, fixed before the run. */
  asks: string;
  /** What result would count as an answer, also fixed before the run. */
  decidedBy: string;
  arms: Arm[];
  repeats: number;
  budgetPerRoom: number;
  /**
   * Play rooms 1-6 once per strategy, snapshot, then branch the conditions from
   * identical history. Cheaper, and a cleaner comparison, since the conditions
   * then differ only in the intervention.
   */
  sharedPrefix: boolean;
}

export const PROTOCOLS: Protocol[] = [
  {
    id: 'smoke',
    title: 'Pipeline smoke test',
    asks: 'Does the whole loop run end to end without falling over?',
    decidedBy: 'It finishes without provider errors or invalid replies. It measures nothing.',
    arms: [{ strategy: 'structured', condition: 'hidden' }],
    repeats: 1,
    budgetPerRoom: 20,
    sharedPrefix: false,
  },
  {
    // THE MAIN QUESTION. Everything else in this file is a sub-experiment.
    id: 'acquisition-and-revision',
    title: 'Discovering rules, then revising one',
    asks:
      'Can an agent discover the rules of an unknown world, carry them across rooms, notice when a rule it relied on has silently changed, and revise its model without wrecking the parts that were still right?',
    decidedBy:
      'Rooms 1-6 measure acquisition: rooms finished, prediction accuracy, and whether the hazard is avoided in room 4 once it has been met in room 3. Rooms 7-8 measure revision: detection delay from the first press that could have revealed the change, stale-rule actions and deaths, whether recovery is reached, whether transfer to room 8 follows, and how much accuracy is lost on the rules that did NOT change. The stable arm is the control — it plays the same eight rooms with nothing swapped, so any drop in rooms 7-8 that also appears there is the rooms, not the change.',
    arms: [
      { strategy: 'structured', condition: 'stable' },
      { strategy: 'structured', condition: 'hidden' },
      { strategy: 'structured', condition: 'notified' },
    ],
    repeats: 1,
    budgetPerRoom: 25,
    sharedPrefix: true,
  },
  {
    id: 'detection-vs-relearning',
    title: 'Is noticing the hard part, or re-learning?',
    asks:
      'Does telling the agent that something changed, without saying what, speed up revision?',
    decidedBy:
      'Detection delay and steps to recovery in the hidden arm against the announced arm, same memory format. A small gap means noticing was never the bottleneck and the cost is in re-learning.',
    arms: [
      { strategy: 'structured', condition: 'hidden' },
      { strategy: 'structured', condition: 'notified' },
    ],
    repeats: 1,
    budgetPerRoom: 25,
    sharedPrefix: true,
  },
  {
    // A SUB-EXPERIMENT, not the definition of the project. It asks whether one
    // way of storing beliefs revises better than another; it says nothing about
    // whether the beliefs can be acquired in the first place, which is what
    // rooms 1-6 are for and what the main protocol measures.
    id: 'memory-comparison',
    title: 'Sub-experiment: flat vs structured memory',
    asks:
      'Holding the world constant, does a structured belief store revise faster than free text, and does it damage fewer of the beliefs that were still correct?',
    decidedBy:
      'Detection delay and steps to recovery, flat against structured at the same condition, plus the drop in accuracy on fields the change did not touch — the one collateral measure that works for both formats, since a flat store has no statuses to demote. Needs far more repeats than the default to separate two arms.',
    arms: [
      { strategy: 'flat', condition: 'hidden' },
      { strategy: 'structured', condition: 'hidden' },
      { strategy: 'flat', condition: 'notified' },
      { strategy: 'structured', condition: 'notified' },
    ],
    repeats: 1,
    budgetPerRoom: 25,
    sharedPrefix: true,
  },
];

/** Upper bound on model calls, so the cost is visible before anything is spent. */
export function estimateCalls(p: Protocol, rooms = 8, prefixRooms = 6): number {
  if (!p.sharedPrefix) return p.repeats * p.arms.length * rooms * p.budgetPerRoom;
  const strategies = new Set(p.arms.map((a) => a.strategy)).size;
  const prefix = strategies * prefixRooms * p.budgetPerRoom;
  const branches = p.arms.length * (rooms - prefixRooms) * p.budgetPerRoom;
  return p.repeats * (prefix + branches);
}
