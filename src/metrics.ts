import { CHANGED_RULES, DEFAULT_RULES, step } from './engine/engine.ts';
import { LEVELS } from './engine/levels.ts';
import { PREDICTION_FIELDS, type Prediction, type PredictionField } from './agent/schema.ts';
import type { Button, EntityState, Level, Rules } from './engine/types.ts';

/**
 * Metrics, computed only from things that can be checked.
 *
 * Everything here is arithmetic over recorded positions and statuses. Nothing
 * reads the agent's prose. It is tempting to score "did it revise the right
 * belief?" by having something read the claims and judge them, but that would
 * manufacture a measurement out of how well the model writes, and a
 * well-written wrong answer would score better than a terse right one. Where a
 * question cannot be settled by comparison, it is left to a human and surfaced
 * in the UI rather than turned into a number.
 */

/** The observable result of one press: the same four things the agent predicts. */
export interface Outcome {
  end_position: { x: number; y: number };
  position_changed: boolean;
  returned_to_start: boolean;
  room_changed: boolean;
}

export function outcomeOf(args: {
  /** the square the CURRENT room began on */
  roomStart: { x: number; y: number };
  before: { x: number; y: number };
  after: { x: number; y: number };
  /** the next turn is in a different room — by ending it, or by running out */
  roomChanged: boolean;
}): Outcome {
  const { roomStart, before, after } = args;
  return {
    end_position: { x: after.x, y: after.y },
    position_changed: after.x !== before.x || after.y !== before.y,
    returned_to_start: after.x === roomStart.x && after.y === roomStart.y,
    room_changed: args.roomChanged,
  };
}

function sameField(a: Outcome[PredictionField], b: Outcome[PredictionField]): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  return a.x === b.x && a.y === b.y;
}

/**
 * Which of the four observables would read differently under the other rules.
 *
 * This is the whole basis of the recovery criterion. A press where nothing
 * diverges tells the agent nothing about the swap however well it predicts it,
 * so predicting it correctly must not count toward having recovered — which is
 * exactly the defect this replaces. Three ordinary moves used to be enough.
 */
export function divergentFields(a: Outcome, b: Outcome): PredictionField[] {
  return PREDICTION_FIELDS.filter((f) => !sameField(a[f], b[f]));
}

/**
 * Resolve one press twice — under the rules in force and under the other set —
 * and report both in the agent's own four observable terms.
 *
 * The counterfactual is the instrument. Without it there is no way to say which
 * presses could possibly have revealed the change, so there is no way to tell a
 * prediction that demonstrates a revised world model from one that demonstrates
 * the agent can count squares. `divergent_fields` is what makes the recovery
 * criterion mean something, and it is computed here, from the engine, for every
 * press, in every condition.
 */
export function resolveBoth(
  level: Level,
  before: EntityState,
  button: Button,
  rules: Rules,
  levelStep: number,
  budget: number,
): { outcome: Outcome; other: Outcome; divergent: PredictionField[] } {
  const other = rules.swapped ? DEFAULT_RULES : CHANGED_RULES;
  const a = step(level, before, button, rules);
  const b = step(level, before, button, other);
  const ended = levelStep >= budget;
  const mk = (r: ReturnType<typeof step>) =>
    outcomeOf({
      roomStart: level.start,
      before,
      after: r.state,
      roomChanged: r.complete || ended,
    });
  const outcome = mk(a);
  const otherOutcome = mk(b);
  return { outcome, other: otherOutcome, divergent: divergentFields(outcome, otherOutcome) };
}

/** null = the agent declined on this field; otherwise whether it was right. */
export function scoreField(
  p: Prediction | null | undefined,
  o: Outcome,
  f: PredictionField,
): boolean | null {
  if (!p) return null;
  const claimed = p[f];
  if (claimed === null || claimed === undefined) return null;
  return sameField(claimed as Outcome[PredictionField], o[f]);
}

export interface StepRecord {
  type: 'step';
  level: number;
  global_step: number;
  level_step: number;
  button: Button;
  hypothesis: string;
  prediction: string;
  expect?: Prediction | null;
  contradiction: string | null;
  memory_in_prompt?: string;
  memory_accepted?: string;
  level_complete: boolean;
  researcher: {
    true_rules: Rules;
    entity_before: EntityState;
    entity_after: EntityState;
    /** every intermediate pose, for the replay renderer */
    path?: EntityState[];
    blocked: boolean;
    died?: boolean;
    died_at?: { x: number; y: number } | null;
    auto_moved: number;
    /** what actually happened, in the agent's own four terms */
    outcome: Outcome;
    /** what would have happened under the other rule set */
    outcome_under_other_rules: Outcome;
    /** the fields where those two disagree — empty means the press told nothing */
    divergent_fields: PredictionField[];
    discriminating_under_rule_change: boolean;
    intervention_applied: boolean;
    /** the press crossed the surface that is lethal under the rules in force */
    touched_lethal?: boolean;
    /** the press crossed the surface that ended rooms BEFORE the change */
    touched_original_objective?: boolean;
  };
}

/** Whether every field the agent committed to turned out right. */
export type Verdict = true | false | null;

export function verdictOf(s: StepRecord): Verdict {
  const o = s.researcher.outcome;
  if (!o) return null;
  let committed = 0;
  for (const f of PREDICTION_FIELDS) {
    const v = scoreField(s.expect, o, f);
    if (v === null) continue;
    committed++;
    if (!v) return false;
  }
  return committed ? true : null;
}

/**
 * THE RECOVERY CRITERION, fixed in advance.
 *
 * An agent has recovered when BOTH of these have happened after the change:
 *
 *   R1  it made a correct prediction about something the change actually
 *       altered — a press whose observable outcome differs between the two rule
 *       sets, on one of the fields where they differ.
 *   R2  it finished a room after the change.
 *
 * `recoveredAtStep` is whichever of the two landed last.
 *
 * WHAT THIS REPLACES, AND WHY. The previous criterion was three consecutive
 * correct predictions of any kind. That is satisfiable by walking down an empty
 * corridor: three presses that would have looked identical before and after the
 * swap, predicted correctly by a model that has not revised anything at all. It
 * measured whether the agent could still count squares, and reported it as
 * having understood a rule change. R1 cannot be satisfied that way — the press
 * has to be one where the old rule and the new rule predict different things,
 * and the agent has to have called the difference.
 *
 * R2 is there because a prediction is cheap and a room is not. An agent can be
 * right about what a surface does and still never act on it.
 *
 * Transfer to the last room is deliberately NOT part of this conjunction. It is
 * a strictly harder bar, most runs will never reach it, and folding it in would
 * make `recovered` false for nearly every run in every arm — a number that is
 * always zero separates nothing. It is reported beside recovery instead, as
 * `transferSucceeded`.
 */
export const RECOVERY_CRITERION =
  'a correct prediction on a field the change altered, plus a room finished after the change';

/** The last room. Reaching it after a change is transfer, not recovery. */
export const TRANSFER_LEVEL = LEVELS.length;

export interface Metrics {
  totalActions: number;
  roomsSolved: number;
  deaths: number;
  deathsAfterChange: number;

  /** every committed field is one falsifiable claim; this is the headline rate */
  fieldsCommitted: number;
  fieldsCorrect: number;
  accuracy: number | null;
  /** a press where the world contradicted at least one committed field */
  predictionViolations: number;
  /** presses on which the agent committed to nothing at all */
  predictionsDeclined: number;

  interventionAtStep: number | null;
  /** first press after the change that could have revealed it */
  firstEvidenceStep: number | null;
  /** R1 — first correct prediction on a field the change altered */
  firstRevisedPredictionStep: number | null;
  /** first self-reported contradiction at or after the first evidence */
  flaggedAtStep: number | null;
  /** R1 measured from the first press that could have shown the change */
  detectionDelay: number | null;
  /** R1 measured from the change itself, which the agent cannot see */
  detectionDelayFromChange: number | null;

  /** committed predictions on altered fields that the world contradicted */
  ruleRelevantViolations: number;
  /** ... of those, the ones that were exactly what the OLD rule predicted */
  staleRulePredictions: number;
  /** presses after the change that walked onto the surface that used to finish rooms */
  staleRuleActions: number;
  /** ... of those, the ones that cost the entity the room */
  staleRuleDeaths: number;

  /** R2 — first room finished after the change */
  postChangeCompletionStep: number | null;
  recovered: boolean;
  recoveredAtStep: number | null;
  transferStep: number | null;
  transferSucceeded: boolean;

  /**
   * Accuracy on fields the change did NOT alter, before and after it.
   *
   * Collateral damage, and the only form of it that works for both memory
   * formats: a flat store has no statuses to demote, so belief bookkeeping
   * cannot compare the arms. A drop here means the agent broke parts of its
   * model that were still correct.
   */
  collateralAccuracyBefore: number | null;
  collateralAccuracyAfter: number | null;
  collateralDrop: number | null;

  /** status transitions per belief id, structured memory only */
  statusChanges: StatusChange[];
  /** beliefs that were confirmed before the change and demoted after it */
  demotedAfterChange: string[];

  /** per room, how often the agent put itself on the surface that kills */
  hazardContacts: Array<{ level: number; presses: number; deaths: number }>;
}

export interface StatusChange {
  step: number;
  id: string;
  from: string | null;
  to: string;
}

interface Entry {
  id: string;
  status: string;
  claim?: string;
  depends_on?: string[];
}

function parseEntries(json: string | undefined): Entry[] | null {
  if (!json) return null;
  const t = json.trim();
  if (!t.startsWith('[')) return null; // flat memory, nothing to track
  try {
    const arr = JSON.parse(t);
    return Array.isArray(arr) ? arr.filter((e) => e && typeof e.id === 'string') : null;
  } catch {
    return null;
  }
}

export interface BeliefTrack {
  id: string;
  claim: string;
  /** status at each step index, or null before the belief existed */
  status: (string | null)[];
  depends_on: string[];
}

/**
 * The agent's beliefs as a grid: one row per belief, one column per step.
 *
 * This is the view that makes revision legible. A rule silently changing is
 * invisible in a wall of JSON, but a row that runs green and then turns amber
 * at one column is the exact moment the agent stopped trusting something — and
 * which neighbouring rows stayed green is the whole question the project asks.
 */
export function beliefTracks(steps: StepRecord[]): BeliefTrack[] {
  const rows = new Map<string, BeliefTrack>();
  steps.forEach((s, i) => {
    const entries = parseEntries(s.memory_accepted);
    if (!entries) return;
    for (const e of entries) {
      let row = rows.get(e.id);
      if (!row) {
        row = { id: e.id, claim: '', status: new Array(steps.length).fill(null), depends_on: [] };
        rows.set(e.id, row);
      }
      row.status[i] = e.status;
      row.claim = (e as { claim?: string }).claim ?? row.claim;
      row.depends_on = (e as { depends_on?: string[] }).depends_on ?? row.depends_on;
    }
  });
  // roots first, then things built on them, so dependency reads top-down
  return [...rows.values()].sort(
    (a, b) => a.depends_on.length - b.depends_on.length || a.id.localeCompare(b.id),
  );
}

function rate(correct: number, total: number): number | null {
  return total > 0 ? correct / total : null;
}

export function computeMetrics(steps: StepRecord[]): Metrics {
  const m: Metrics = {
    totalActions: steps.length,
    roomsSolved: steps.filter((s) => s.level_complete).length,
    deaths: steps.filter((s) => s.researcher.died).length,
    deathsAfterChange: steps.filter((s) => s.researcher.died && s.researcher.intervention_applied).length,
    fieldsCommitted: 0,
    fieldsCorrect: 0,
    accuracy: null,
    predictionViolations: 0,
    predictionsDeclined: 0,
    interventionAtStep: null,
    firstEvidenceStep: null,
    firstRevisedPredictionStep: null,
    flaggedAtStep: null,
    detectionDelay: null,
    detectionDelayFromChange: null,
    ruleRelevantViolations: 0,
    staleRulePredictions: 0,
    staleRuleActions: 0,
    staleRuleDeaths: 0,
    postChangeCompletionStep: null,
    recovered: false,
    recoveredAtStep: null,
    transferStep: null,
    transferSucceeded: false,
    collateralAccuracyBefore: null,
    collateralAccuracyAfter: null,
    collateralDrop: null,
    statusChanges: [],
    demotedAfterChange: [],
    hazardContacts: [],
  };

  let prevStatus = new Map<string, string>();
  const statusBeforeChange = new Map<string, string>();
  const hazard = new Map<number, { presses: number; deaths: number }>();
  let steadyBefore = { correct: 0, total: 0 };
  let steadyAfter = { correct: 0, total: 0 };

  for (const s of steps) {
    const r = s.researcher;
    const changed = r.intervention_applied;
    const outcome = r.outcome;
    const divergent = r.divergent_fields ?? [];
    if (changed && m.interventionAtStep === null) m.interventionAtStep = s.global_step;

    if (r.touched_lethal) {
      const h = hazard.get(s.level) ?? { presses: 0, deaths: 0 };
      h.presses++;
      if (r.died) h.deaths++;
      hazard.set(s.level, h);
    }

    // ---- field-level scoring ----
    let committedHere = 0;
    let violatedHere = false;
    if (outcome) {
      for (const f of PREDICTION_FIELDS) {
        const v = scoreField(s.expect, outcome, f);
        if (v === null) continue;
        committedHere++;
        m.fieldsCommitted++;
        if (v) m.fieldsCorrect++;
        else violatedHere = true;

        // collateral: only fields the change did not touch
        if (!divergent.includes(f)) {
          const bucket = changed ? steadyAfter : steadyBefore;
          bucket.total++;
          if (v) bucket.correct++;
        }
      }
    }
    if (committedHere === 0) m.predictionsDeclined++;
    if (violatedHere) m.predictionViolations++;

    if (!changed) {
      // ---- belief bookkeeping still runs before the change ----
      prevStatus = trackBeliefs(s, prevStatus, statusBeforeChange, m, false);
      continue;
    }

    // ---- everything below is post-change only ----
    if (divergent.length && m.firstEvidenceStep === null) m.firstEvidenceStep = s.global_step;

    if (outcome && divergent.length) {
      let calledIt = false;
      for (const f of divergent) {
        const v = scoreField(s.expect, outcome, f);
        if (v === null) continue;
        if (v) calledIt = true;
        else {
          m.ruleRelevantViolations++;
          // was the wrong answer exactly what the dead rule would have given?
          const stale = r.outcome_under_other_rules;
          if (stale && scoreField(s.expect, stale, f) === true) m.staleRulePredictions++;
        }
      }
      if (calledIt && m.firstRevisedPredictionStep === null)
        m.firstRevisedPredictionStep = s.global_step;
    }

    if (r.touched_original_objective) {
      m.staleRuleActions++;
      if (r.died) m.staleRuleDeaths++;
    }

    if (
      s.contradiction &&
      m.flaggedAtStep === null &&
      m.firstEvidenceStep !== null &&
      s.global_step >= m.firstEvidenceStep
    )
      m.flaggedAtStep = s.global_step;

    if (s.level_complete) {
      if (m.postChangeCompletionStep === null) m.postChangeCompletionStep = s.global_step;
      if (s.level >= TRANSFER_LEVEL && m.transferStep === null) m.transferStep = s.global_step;
    }

    prevStatus = trackBeliefs(s, prevStatus, statusBeforeChange, m, true);
  }

  m.accuracy = rate(m.fieldsCorrect, m.fieldsCommitted);
  m.collateralAccuracyBefore = rate(steadyBefore.correct, steadyBefore.total);
  m.collateralAccuracyAfter = rate(steadyAfter.correct, steadyAfter.total);
  if (m.collateralAccuracyBefore !== null && m.collateralAccuracyAfter !== null)
    m.collateralDrop = m.collateralAccuracyBefore - m.collateralAccuracyAfter;

  const r1 = m.firstRevisedPredictionStep;
  const r2 = m.postChangeCompletionStep;
  m.recovered = r1 !== null && r2 !== null;
  m.recoveredAtStep = m.recovered ? Math.max(r1!, r2!) : null;
  m.transferSucceeded = m.transferStep !== null;

  if (r1 !== null && m.firstEvidenceStep !== null) m.detectionDelay = r1 - m.firstEvidenceStep;
  if (r1 !== null && m.interventionAtStep !== null)
    m.detectionDelayFromChange = r1 - m.interventionAtStep;

  m.hazardContacts = [...hazard.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, h]) => ({ level, ...h }));

  return m;
}

/** Status transitions, and beliefs demoted after the change. Structured only. */
function trackBeliefs(
  s: StepRecord,
  prevStatus: Map<string, string>,
  statusBeforeChange: Map<string, string>,
  m: Metrics,
  changed: boolean,
): Map<string, string> {
  const entries = parseEntries(s.memory_accepted);
  if (!entries) return prevStatus;
  const now = new Map(entries.map((e) => [e.id, e.status]));
  for (const [id, status] of now) {
    const before = prevStatus.get(id) ?? null;
    if (before !== status) m.statusChanges.push({ step: s.global_step, id, from: before, to: status });
    if (!changed) statusBeforeChange.set(id, status);
    else if (statusBeforeChange.get(id) === 'confirmed' && status !== 'confirmed')
      if (!m.demotedAfterChange.includes(id)) m.demotedAfterChange.push(id);
  }
  return now;
}
