import type { EntityState, Rules } from './engine/types.ts';

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

export interface StepRecord {
  type: 'step';
  level: number;
  global_step: number;
  level_step: number;
  button: 'A' | 'B' | 'C' | 'D';
  hypothesis: string;
  prediction: string;
  predicted_position?: { x: number; y: number } | null;
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
    auto_moved: number;
    discriminating_under_rule_change: boolean;
    intervention_applied: boolean;
  };
}

/** How a committed prediction turned out. `null` = the agent declined to commit. */
export type Verdict = true | false | null;

export function verdictOf(s: StepRecord): Verdict {
  const p = s.predicted_position;
  if (!p) return null;
  return p.x === s.researcher.entity_after.x && p.y === s.researcher.entity_after.y;
}

/**
 * The recovery criterion, fixed in advance.
 *
 * Recovered = three consecutive COMMITTED predictions, all correct, all after
 * the rule changed. Declining to predict breaks the streak without counting
 * against the agent — it neither proves nor disproves that its model is working
 * again.
 *
 * Three rather than one, because a single correct prediction after a change is
 * as likely to be luck as understanding. A first success and a recovery are
 * different events and are reported separately; calling the first one recovery
 * is the easiest way to overstate a result.
 */
export const RECOVERY_STREAK = 3;

export interface Metrics {
  totalActions: number;
  roomsSolved: number;
  /** committed predictions, and how many were right */
  predictionsCommitted: number;
  predictionsCorrect: number;
  predictionsDeclined: number;
  accuracy: number | null;

  interventionAtStep: number | null;
  /** first press whose outcome would differ under the other rule set */
  firstTellingStep: number | null;
  /** first press after the change whose committed prediction was right */
  firstCorrectAfterChange: number | null;
  /** first room completed after the change */
  firstSuccessAfterChange: number | null;
  /** first step at which the recovery criterion above was met */
  recoveredAtStep: number | null;
  /**
   * Telling presses the agent made after the change while still predicting
   * wrongly. This is the closest honest proxy for "kept acting on the dead
   * rule": each one is an opportunity to notice that it did not take.
   */
  tellingPressesBeforeRecovery: number;

  /** status transitions per belief id, structured memory only */
  statusChanges: StatusChange[];
  /** beliefs that were confirmed before the change and demoted after it */
  demotedAfterChange: string[];
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

export function computeMetrics(steps: StepRecord[]): Metrics {
  const m: Metrics = {
    totalActions: steps.length,
    roomsSolved: steps.filter((s) => s.level_complete).length,
    predictionsCommitted: 0,
    predictionsCorrect: 0,
    predictionsDeclined: 0,
    accuracy: null,
    interventionAtStep: null,
    firstTellingStep: null,
    firstCorrectAfterChange: null,
    firstSuccessAfterChange: null,
    recoveredAtStep: null,
    tellingPressesBeforeRecovery: 0,
    statusChanges: [],
    demotedAfterChange: [],
  };

  let streak = 0;
  let prevStatus = new Map<string, string>();
  const statusBeforeChange = new Map<string, string>();

  for (const s of steps) {
    const changed = s.researcher.intervention_applied;
    if (changed && m.interventionAtStep === null) m.interventionAtStep = s.global_step;

    const v = verdictOf(s);
    if (v === null) m.predictionsDeclined++;
    else {
      m.predictionsCommitted++;
      if (v) m.predictionsCorrect++;
    }

    if (changed) {
      if (s.researcher.discriminating_under_rule_change) {
        if (m.firstTellingStep === null) m.firstTellingStep = s.global_step;
        if (m.recoveredAtStep === null && v !== true) m.tellingPressesBeforeRecovery++;
      }
      if (v === true && m.firstCorrectAfterChange === null)
        m.firstCorrectAfterChange = s.global_step;
      if (s.level_complete && m.firstSuccessAfterChange === null)
        m.firstSuccessAfterChange = s.global_step;

      // a declined prediction breaks the streak without being held against it
      streak = v === true ? streak + 1 : 0;
      if (streak >= RECOVERY_STREAK && m.recoveredAtStep === null)
        m.recoveredAtStep = s.global_step;
    }

    const entries = parseEntries(s.memory_accepted);
    if (entries) {
      const now = new Map(entries.map((e) => [e.id, e.status]));
      for (const [id, status] of now) {
        const before = prevStatus.get(id) ?? null;
        if (before !== status) m.statusChanges.push({ step: s.global_step, id, from: before, to: status });
        if (!changed) statusBeforeChange.set(id, status);
        else if (statusBeforeChange.get(id) === 'confirmed' && status !== 'confirmed')
          if (!m.demotedAfterChange.includes(id)) m.demotedAfterChange.push(id);
      }
      prevStatus = now;
    }
  }

  if (m.predictionsCommitted > 0) m.accuracy = m.predictionsCorrect / m.predictionsCommitted;
  return m;
}
