import { CHANGED_RULES, DEFAULT_RULES, step } from './engine/engine.ts';
import { INTERVENTION_BEFORE_LEVEL, LEVELS } from './engine/levels.ts';
import { buildObservation, pose, type LastAction, type Observation, type PreviousRoom } from './engine/observation.ts';
import { ENGINE_VERSION, type Button, type EntityState, type Rules } from './engine/types.ts';
import { applyMemory, emptyMemory, MEMORY_BUDGET_CHARS, renderMemory, type Memory, type StrategyName } from './agent/memory.ts';
import { systemPrompt, userPrompt } from './agent/prompt.ts';
import { extractJson, validate } from './agent/schema.ts';

export type Condition = 'stable' | 'hidden' | 'notified';
export type Driver = 'llm' | 'random' | 'manual';

export const CHANGE_NOTICE = 'One of the rules of this world has changed.';

export interface RunConfig {
  runId: string;
  strategy: StrategyName;
  condition: Condition;
  driver: Driver;
  actionBudgetPerLevel: number;
  seed: number;
  /** free demonstration runs are tagged so they never pool with experiments */
  manualIntervention?: boolean;
}

export interface RunSnapshot {
  fromRunId: string;
  memory: Memory;
  levelIndex: number;
  levelsCompleted: number;
  levelOutcomes: Array<{ level: number; solved: boolean; actions: number }>;
  globalStep: number;
}

export interface FeedItem {
  kind: 'action' | 'complete' | 'failed' | 'memory' | 'contradiction' | 'rule-change' | 'error';
  text: string;
  detail?: string;
  researcherOnly?: boolean;
  step: number;
}

export interface RunState {
  config: RunConfig;
  levelIndex: number;
  entity: EntityState;
  rules: Rules;
  memory: Memory;
  globalStep: number;
  levelStep: number;
  path: EntityState[];
  animToken: number;
  lastAction: LastAction | null;
  previousRoom: PreviousRoom | null;
  lastReply: { hypothesis: string; prediction: string; contradiction: string | null } | null;
  changedEntryIds: string[];
  feed: FeedItem[];
  running: boolean;
  inFlight: boolean;
  finished: boolean;
  error: string | null;
  levelsCompleted: number;
  levelOutcomes: Array<{ level: number; solved: boolean; actions: number }>;
  invalidReplies: number;
  usage: { input: number; output: number; calls: number; ms: number };
  interventionAtStep: number | null;
  firstDiscriminatingStep: number | null;
  firstSuccessAfterChange: number | null;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Run {
  state: RunState;
  private rng: () => number;
  private memoryRejected: string | null = null;
  private lastInvalid: string | null = null;
  private lastPrediction: string | null = null;
  private lastPromptSent = '';
  private buffer: unknown[] = [];
  private emit: () => void;

  constructor(config: RunConfig, emit: () => void, resume?: RunSnapshot) {
    this.emit = emit;
    this.rng = mulberry32(config.seed);
    const startLevel = resume?.levelIndex ?? 0;
    const lv = LEVELS[startLevel];
    this.state = {
      config,
      levelIndex: startLevel,
      entity: { ...lv.start },
      rules: { ...DEFAULT_RULES },
      memory: resume?.memory ?? emptyMemory(config.strategy),
      globalStep: resume?.globalStep ?? 0,
      levelStep: 0,
      path: [{ ...lv.start }],
      animToken: 0,
      lastAction: null,
      previousRoom: null,
      lastReply: null,
      changedEntryIds: [],
      feed: [],
      running: false,
      inFlight: false,
      finished: false,
      error: null,
      levelsCompleted: resume?.levelsCompleted ?? 0,
      levelOutcomes: resume ? [...resume.levelOutcomes] : [],
      invalidReplies: 0,
      usage: { input: 0, output: 0, calls: 0, ms: 0 },
      interventionAtStep: null,
      firstDiscriminatingStep: null,
      firstSuccessAfterChange: null,
    };
    this.log({
      type: 'run_start',
      at: new Date().toISOString(),
      config,
      engine_version: ENGINE_VERSION,
      resumed_from: resume ? { level_index: resume.levelIndex, from_run: resume.fromRunId } : null,
      // Logged in full and once. Together with each step's prompt_user this
      // makes the exact request the model answered reconstructible from the
      // log alone, without rerunning anything.
      system_prompt: systemPrompt(config.strategy),
      memory_budget_chars: MEMORY_BUDGET_CHARS,
    });
    // A run that resumes at the intervention level must have the change applied
    // on entry, exactly as a continuous run would when it advanced into it.
    if (resume) this.maybeIntervene();
  }

  /** Freeze everything that carries forward, so continuations can branch. */
  snapshot(): RunSnapshot {
    const s = this.state;
    return {
      fromRunId: s.config.runId,
      memory: JSON.parse(JSON.stringify(s.memory)),
      levelIndex: s.levelIndex,
      levelsCompleted: s.levelsCompleted,
      levelOutcomes: [...s.levelOutcomes],
      globalStep: s.globalStep,
    };
  }

  get level() {
    return LEVELS[this.state.levelIndex];
  }

  private push(item: Omit<FeedItem, 'step'>) {
    this.state.feed.unshift({ ...item, step: this.state.globalStep });
    if (this.state.feed.length > 300) this.state.feed.length = 300;
  }

  private log(record: unknown) {
    this.buffer.push(record);
    void this.flush();
  }

  private async flush() {
    if (!this.buffer.length) return;
    const records = this.buffer.splice(0, this.buffer.length);
    try {
      await fetch('/api/log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId: this.state.config.runId, records }),
      });
    } catch {
      // the in-memory copy is still intact, so export still works
    }
  }

  observation(): Observation {
    const s = this.state;
    const notice =
      s.config.condition === 'notified' &&
      s.levelIndex + 1 === INTERVENTION_BEFORE_LEVEL &&
      s.levelStep === 0
        ? CHANGE_NOTICE
        : undefined;
    return buildObservation({
      level: this.level,
      roomIndex: s.levelIndex + 1,
      state: s.entity,
      lastAction: s.lastAction,
      actionsUsed: s.levelStep,
      actionsRemaining: s.config.actionBudgetPerLevel - s.levelStep,
      previousRoom: s.previousRoom ?? undefined,
      notice,
    });
  }

  /** Researcher-side only: would this press look different under the other rules? */
  private isDiscriminating(from: EntityState, button: Button): boolean {
    const a = step(this.level, from, button, DEFAULT_RULES);
    const b = step(this.level, from, button, CHANGED_RULES);
    return JSON.stringify(a.state) !== JSON.stringify(b.state) || a.complete !== b.complete;
  }

  /** Apply the scheduled hidden change, if this run has one and it is due. */
  private maybeIntervene() {
    const s = this.state;
    if (s.config.condition === 'stable' || s.interventionAtStep !== null) return;
    if (s.levelIndex + 1 !== INTERVENTION_BEFORE_LEVEL) return;
    s.rules = { ...CHANGED_RULES };
    s.interventionAtStep = s.globalStep;
    this.push({
      kind: 'rule-change',
      text: `Rule change applied before room ${INTERVENTION_BEFORE_LEVEL}`,
      detail: 'striped surface no longer carries the entity',
      researcherOnly: true,
    });
    this.log({
      type: 'intervention',
      at_global_step: s.globalStep,
      before_level: INTERVENTION_BEFORE_LEVEL,
      rules_after: s.rules,
    });
  }

  /** Force the change from the UI, for free demonstration. Tagged as manual. */
  forceRuleChange() {
    const s = this.state;
    s.rules = { ...CHANGED_RULES };
    s.config.manualIntervention = true;
    if (s.interventionAtStep === null) s.interventionAtStep = s.globalStep;
    this.push({
      kind: 'rule-change',
      text: 'Rule changed by hand (manual run, not experimental data)',
      researcherOnly: true,
    });
    this.log({ type: 'intervention', manual: true, at_global_step: s.globalStep, rules_after: s.rules });
    this.emit();
  }

  private advanceLevel(solved: boolean) {
    const s = this.state;
    s.levelOutcomes.push({ level: s.levelIndex + 1, solved, actions: s.levelStep });
    if (solved) s.levelsCompleted++;
    if (!solved)
      this.push({
        kind: 'failed',
        text: `Room ${s.levelIndex + 1} not solved within ${s.config.actionBudgetPerLevel} actions`,
      });

    if (s.levelIndex + 1 >= LEVELS.length) {
      s.finished = true;
      s.running = false;
      this.log({ type: 'run_end', at: new Date().toISOString(), summary: this.summary() });
      return;
    }
    // Carry the closing press forward as an explicit outcome. The agent has to
    // be able to connect its action to the room ending; clearing this was the
    // bug that made that impossible.
    s.previousRoom = s.lastAction
      ? {
          room_index: s.levelIndex + 1,
          outcome: solved ? 'completed' : 'ran_out_of_actions',
          final_action: s.lastAction,
        }
      : null;

    s.levelIndex++;
    s.levelStep = 0;
    s.entity = { ...this.level.start };
    s.path = [{ ...this.level.start }];
    s.animToken++;
    s.lastAction = null; // new room: nothing has been tried in IT yet
    // lastPrediction is deliberately kept: it belongs to the closing press,
    // which the agent is about to be shown in previous_room.
    this.maybeIntervene();
  }

  /** Execute one validated button press against the engine. */
  private commit(
    button: Button,
    meta: { hypothesis: string; prediction: string; contradiction: string | null },
    /**
     * The three distinct memory states of one turn. They must be passed in,
     * not read back off `state`: the update has already been applied by the
     * time this runs, so reading `state.memory` here recorded the NEW memory as
     * `memory_before` and made every logged step claim the agent saw the memory
     * it had just written. That silently destroyed the log's ability to answer
     * the one question it exists for — what did the agent know when it chose?
     */
    mem?: { inPrompt: string; proposed: string; accepted: string; rejected: string | null },
  ) {
    const s = this.state;
    const before = { ...s.entity };
    const obsBefore = this.observation();
    const memInPrompt = mem?.inPrompt ?? renderMemory(s.memory);
    const discriminating = this.isDiscriminating(before, button);

    const r = step(this.level, before, button, s.rules);
    s.entity = r.state;
    s.path = r.path;
    s.animToken++;
    s.globalStep++;
    s.levelStep++;
    s.previousRoom = null; // it has now acted in this room; the report is spent
    s.lastAction = {
      button,
      before: pose(before),
      after: pose(r.state),
      level_complete: r.complete,
    };
    s.lastReply = meta;
    this.lastPrediction = meta.prediction;

    if (discriminating && s.interventionAtStep !== null && s.firstDiscriminatingStep === null)
      s.firstDiscriminatingStep = s.globalStep;

    const moveText = r.blocked
      ? 'nothing moved'
      : `${before.x},${before.y} to ${r.state.x},${r.state.y}` +
        (r.autoMoved ? ` (carried ${r.autoMoved})` : '');
    this.push({ kind: 'action', text: `${button} — ${moveText}`, detail: meta.hypothesis });
    if (meta.contradiction) this.push({ kind: 'contradiction', text: meta.contradiction });

    this.log({
      type: 'step',
      run_id: s.config.runId,
      level: s.levelIndex + 1,
      global_step: s.globalStep,
      level_step: s.levelStep,
      observation_before: obsBefore,
      // exactly what was in the request the model answered
      prompt_user: mem ? this.lastPromptSent : null,
      // the system half is constant per run and logged once in run_start
      memory_in_prompt: memInPrompt,
      memory_proposed: mem?.proposed ?? memInPrompt,
      memory_accepted: mem?.accepted ?? memInPrompt,
      memory_update_rejected: mem?.rejected ?? null,
      button,
      hypothesis: meta.hypothesis,
      prediction: meta.prediction,
      contradiction: meta.contradiction,
      observation_after: this.observation(),
      level_complete: r.complete,
      // Researcher-only section. None of this is ever built into an observation.
      researcher: {
        true_rules: s.rules,
        entity_before: before,
        entity_after: r.state,
        path: r.path,
        blocked: r.blocked,
        auto_moved: r.autoMoved,
        discriminating_under_rule_change: discriminating,
        intervention_applied: s.interventionAtStep !== null,
        manual_intervention: Boolean(s.config.manualIntervention),
      },
    });

    if (r.complete) {
      this.push({
        kind: 'complete',
        text: `Room ${s.levelIndex + 1} complete in ${s.levelStep} actions`,
      });
      if (s.interventionAtStep !== null && s.firstSuccessAfterChange === null)
        s.firstSuccessAfterChange = s.globalStep;
      this.advanceLevel(true);
    } else if (s.levelStep >= s.config.actionBudgetPerLevel) {
      this.advanceLevel(false);
    }
    this.emit();
  }

  /** The only entry point for a human-pressed button. */
  pressManual(button: Button) {
    if (this.state.inFlight || this.state.finished) return;
    this.commit(button, {
      hypothesis: '(pressed by hand)',
      prediction: 'unknown',
      contradiction: null,
    });
  }

  private async askModel(): Promise<void> {
    const s = this.state;
    const system = systemPrompt(s.config.strategy);
    const user = userPrompt({
      observation: this.observation(),
      memory: s.memory,
      stepNumber: s.globalStep + 1,
      memoryRejected: this.memoryRejected,
      lastInvalid: this.lastInvalid,
      lastPrediction: this.lastPrediction,
    });

    this.lastPromptSent = user;
    const memInPrompt = renderMemory(s.memory);

    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system, user }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `provider returned ${res.status}`);

    s.usage.calls++;
    s.usage.input += payload.usage?.input ?? 0;
    s.usage.output += payload.usage?.output ?? 0;
    s.usage.ms += payload.latencyMs ?? 0;

    this.memoryRejected = null;
    this.lastInvalid = null;

    let parsed: unknown;
    try {
      parsed = extractJson(payload.text ?? '');
    } catch (e: any) {
      this.rejectReply(String(e.message), payload.text);
      return;
    }
    const v = validate(parsed, s.config.strategy);
    if (!v.ok) {
      this.rejectReply(v.error, payload.text);
      return;
    }

    const before = s.memory;
    const applied = applyMemory(before, v.reply.memory);
    this.memoryRejected = applied.rejected;
    s.memory = applied.memory;
    s.changedEntryIds = diffEntries(before, applied.memory);
    if (applied.rejected) this.push({ kind: 'memory', text: applied.rejected });
    else if (s.changedEntryIds.length)
      this.push({ kind: 'memory', text: `memory updated: ${s.changedEntryIds.join(', ')}` });

    this.commit(
      v.reply.button,
      {
        hypothesis: v.reply.hypothesis,
        prediction: v.reply.prediction,
        contradiction: v.reply.contradiction,
      },
      {
        inPrompt: memInPrompt,
        proposed: renderMemory(v.reply.memory),
        accepted: renderMemory(applied.memory),
        rejected: applied.rejected,
      },
    );
  }

  /** A malformed reply costs a model call and performs no world action. */
  private rejectReply(error: string, raw: string) {
    this.state.invalidReplies++;
    this.lastInvalid = error;
    this.push({ kind: 'error', text: `invalid reply: ${error}`, detail: (raw || '').slice(0, 300) });
    this.log({
      type: 'invalid_reply',
      run_id: this.state.config.runId,
      global_step: this.state.globalStep,
      error,
      raw: (raw || '').slice(0, 4000),
    });
    this.emit();
  }

  /** One agent turn. Returns false when the run cannot continue. */
  async stepOnce(): Promise<boolean> {
    const s = this.state;
    if (s.finished || s.inFlight) return false;

    if (s.config.driver === 'manual') return false;

    if (s.config.driver === 'random') {
      const b = (['A', 'B', 'C', 'D'] as Button[])[Math.floor(this.rng() * 4)];
      this.commit(b, {
        hypothesis: '(random agent, integration check only)',
        prediction: 'unknown',
        contradiction: null,
      });
      return true;
    }

    s.inFlight = true;
    s.error = null;
    this.emit();
    try {
      await this.askModel();
      return true;
    } catch (e: any) {
      s.error = String(e?.message ?? e);
      s.running = false;
      this.push({ kind: 'error', text: s.error });
      return false;
    } finally {
      s.inFlight = false;
      this.emit();
    }
  }

  async loop() {
    if (this.state.running) return;
    this.state.running = true;
    this.emit();
    // A pause takes effect between turns, so an in-flight request always lands
    // and is applied rather than being thrown away.
    while (this.state.running && !this.state.finished) {
      const ok = await this.stepOnce();
      if (!ok) break;
      await new Promise((r) => setTimeout(r, 420));
    }
    this.state.running = false;
    this.emit();
  }

  pause() {
    this.state.running = false;
    this.emit();
  }

  summary() {
    const s = this.state;
    return {
      run_id: s.config.runId,
      config: s.config,
      levels_completed: s.levelsCompleted,
      level_outcomes: s.levelOutcomes,
      total_actions: s.globalStep,
      invalid_replies: s.invalidReplies,
      usage: s.usage,
      intervention_at_step: s.interventionAtStep,
      first_discriminating_step: s.firstDiscriminatingStep,
      first_success_after_change: s.firstSuccessAfterChange,
      manual_intervention: Boolean(s.config.manualIntervention),
    };
  }
}

function diffEntries(before: Memory, after: Memory): string[] {
  if (after.kind === 'flat')
    return before.kind === 'flat' && before.text === after.text ? [] : ['memory'];
  const prev = new Map(
    before.kind === 'structured' ? before.entries.map((e) => [e.id, JSON.stringify(e)]) : [],
  );
  return after.entries.filter((e) => prev.get(e.id) !== JSON.stringify(e)).map((e) => e.id);
}
