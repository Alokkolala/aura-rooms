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
    decidedBy: 'It completes without provider errors or invalid replies. It measures nothing.',
    arms: [{ strategy: 'structured', condition: 'hidden' }],
    repeats: 1,
    budgetPerRoom: 20,
    sharedPrefix: false,
  },
  {
    id: 'memory-comparison',
    title: 'Flat vs structured memory',
    asks:
      'After one rule changes, does a structured memory recover faster than a flat one, and does it damage fewer of the beliefs that were still correct?',
    decidedBy:
      'Steps from the change to recovery (3 committed correct predictions in a row), plus how many previously-confirmed beliefs each arm demotes. Needs far more repeats than the default to separate two arms.',
    arms: [
      { strategy: 'flat', condition: 'stable' },
      { strategy: 'flat', condition: 'hidden' },
      { strategy: 'flat', condition: 'notified' },
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
      'Does telling the agent that something changed, without saying what, speed up recovery?',
    decidedBy:
      'Steps to recovery in the hidden arm against the announced arm, same strategy. A small gap means noticing was never the bottleneck.',
    arms: [
      { strategy: 'structured', condition: 'hidden' },
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
