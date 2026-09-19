/**
 * Run a whole campaign headlessly against a real model endpoint.
 *
 *   ANTHROPIC_API_KEY=sk-... npm run campaign
 *   AURA_ENDPOINT=http://localhost:11434/v1 AURA_API_KEY=x AURA_MODEL=llama3.1 npm run campaign
 *
 * Options:
 *   --strategy=flat|structured|native   (default structured; native = codex keeps its own
 *                                context, no memory store — codex provider only)
 *   --condition=stable|hidden|notified   (default hidden)
 *   --budget=N                   actions per room (default 20)
 *   --rooms=N                    stop after N rooms (default all)
 *   --tag=name                   log file prefix
 *   --retries=N                  ask again after a provider error (default 1)
 *   --resume=runs/<id>.jsonl     continue a run that stopped early
 *   --quiet                      one line per press instead of the full trace
 *
 * AURA_TIMEOUT_MS caps a single model call (default 300000).
 *
 * WHY THIS EXISTS. The same protocol can be driven by hand, one model call at a
 * time, and that is how the first runs were done. It is unusable at campaign
 * length: each hand-driven call carried about twenty times more overhead than
 * the work it did, because every call rebuilt an entire agent harness to answer
 * one question about one grid. This script sends exactly the prompt and nothing
 * else, which is both far cheaper and — more importantly — exactly what
 * `src/runner.ts` sends in the browser, so a headless run and a watched run are
 * the same experiment.
 *
 * RESUMING. Nothing carries from one press to the next except the memory store
 * and the last observation, and the log records both. So a run that stopped on
 * a provider error can be continued exactly: the world state, the memory, the
 * counters and the echo of the agent's own last prediction are rebuilt from the
 * log, and the next press is asked from precisely where the previous one left
 * off. The subject cannot tell — it never had any history to lose. Strategy,
 * condition and budget come from the log rather than the command line, because
 * a run whose configuration changed halfway describes two experiments, and the
 * provider, model and system prompt must match what the log recorded for the
 * same reason. A `run_resume` record marks the seam. The check that this is
 * exact: hydrating from any prefix of any committed log reproduces, byte for
 * byte, the prompt the next recorded step actually received.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_RULES, goalGlyph, lethalGlyph, step } from '../src/engine/engine.ts';
import { CHANGED_RULES } from '../src/engine/engine.ts';
import { INTERVENTIONS_BEFORE_LEVELS, LEVELS, NO_HAZARD_LEVELS, swappedAt } from '../src/engine/levels.ts';
import { solve } from '../src/engine/solver.ts';
import {
  buildObservation,
  lastActionOf,
  auditForLeaks,
  OBSERVATION_ABLATIONS,
  type LastAction,
  type PreviousRoom,
} from '../src/engine/observation.ts';
import { ENGINE_VERSION, type Button, type EntityState, type Rules } from '../src/engine/types.ts';
import { applyMemory, emptyMemory, renderMemory, type Memory, type StrategyName } from '../src/agent/memory.ts';
import { systemPrompt, userPrompt } from '../src/agent/prompt.ts';
import { extractJson, validate, PREDICTION_FIELDS, type Prediction } from '../src/agent/schema.ts';
import { computeMetrics, resolveBoth, scoreField, type StepRecord } from '../src/metrics.ts';
import { ask, providerConfig, type CodexSession, type ProviderReply } from '../server/provider.ts';
import { CHANGE_NOTICE, type Condition } from '../src/runner.ts';

const arg = (k: string, d?: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const flag = (k: string) => process.argv.includes(`--${k}`);

const RESUME = arg('resume');
const prior: any[] = RESUME
  ? fs.readFileSync(RESUME, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  : [];
const priorStart = prior.find((r) => r.type === 'run_start');
if (RESUME && !priorStart) throw new Error(`${RESUME}: no run_start record, nothing to resume`);

// A resumed run keeps the configuration it was started with; the flags are
// only read for a fresh one.
const STRATEGY = (priorStart?.config.strategy ?? arg('strategy', 'structured')) as StrategyName;
const CONDITION = (priorStart?.config.condition ?? arg('condition', 'hidden')) as Condition;
const BUDGET = Number(priorStart?.config.actionBudgetPerLevel ?? arg('budget', '20'));
const MAX_ROOMS = Number(arg('rooms', String(LEVELS.length)));
const RETRIES = Number(arg('retries', '1'));
const QUIET = flag('quiet');
const RUN_ID: string =
  priorStart?.config.runId ?? `${arg('tag', 'campaign')}-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;

const RUNS = path.resolve('runs');
fs.mkdirSync(RUNS, { recursive: true });
const LOG = RESUME ? path.resolve(RESUME) : path.join(RUNS, `${RUN_ID}.jsonl`);
const write = (rec: unknown) => fs.appendFileSync(LOG, JSON.stringify(rec) + '\n');

const P = providerConfig();

/** Everything a press needs, and everything the summary counts. */
export interface State {
  strategy: StrategyName;
  condition: Condition;
  budget: number;
  levelIndex: number;
  entity: EntityState;
  rules: Rules;
  memory: Memory;
  globalStep: number;
  levelStep: number;
  interventionAt: number | null;
  lastAction: LastAction | null;
  lastPrediction: string | null;
  lastExpect: Prediction | null;
  memoryRejected: string | null;
  lastInvalid: string | null;
  previousRoom: PreviousRoom | null;
  roomDeaths: number;
  invalid: number;
  toolUseAlarms: number;
  usage: { input: number; output: number; calls: number };
  records: StepRecord[];
  outcomes: Array<{ level: number; solved: boolean; actions: number; deaths: number }>;
}

export function fresh(strategy: StrategyName, condition: Condition, budget: number): State {
  return {
    strategy, condition, budget,
    levelIndex: 0, entity: { ...LEVELS[0].start }, rules: { ...DEFAULT_RULES }, memory: emptyMemory(strategy),
    globalStep: 0, levelStep: 0, interventionAt: null,
    lastAction: null, lastPrediction: null, lastExpect: null, memoryRejected: null, lastInvalid: null,
    previousRoom: null, roomDeaths: 0, invalid: 0, toolUseAlarms: 0,
    usage: { input: 0, output: 0, calls: 0 }, records: [], outcomes: [],
  };
}

/**
 * Rebuild the state a run was in after the last press its log records.
 *
 * Only what the runner itself would have held: the world, the memory store
 * exactly as accepted, the last press as the agent will be shown it, and the
 * echo of what it committed to. Usage spent on a rejected reply is recovered
 * only from logs that recorded the call on it; earlier logs did not.
 */
export function hydrate(records: any[], strategy: StrategyName, condition: Condition, budget: number): State {
  const s = fresh(strategy, condition, budget);
  const steps = records.filter((r) => r.type === 'step');
  const last = steps.at(-1);
  if (!last) throw new Error('nothing to resume: the log has no step records');

  s.rules = { ...last.researcher.true_rules };
  for (const r of records) {
    if (r.type === 'step') {
      // a hand-driven run records no call on its presses
      s.records.push(r);
      if (r.call) { s.usage.calls++; s.usage.input += r.call.usage.input; s.usage.output += r.call.usage.output; }
    } else if (r.type === 'invalid_reply') {
      s.invalid++;
      if (r.call) { s.usage.calls++; s.usage.input += r.call.usage.input; s.usage.output += r.call.usage.output; }
    } else if (r.type === 'seal_alarm') s.toolUseAlarms++;
    else if (r.type === 'intervention') { s.interventionAt = r.at_global_step; s.rules = { ...r.rules_after }; }
  }
  const deathsIn = (level: number) => steps.filter((t) => t.level === level && t.researcher.died).length;
  for (const t of steps)
    if (t.level_complete || t.level_step >= budget)
      s.outcomes.push({ level: t.level, solved: t.level_complete, actions: t.level_step, deaths: deathsIn(t.level) });

  s.globalStep = last.global_step; s.levelStep = last.level_step; s.levelIndex = last.level - 1;
  s.entity = { ...last.researcher.entity_after };
  s.memory = strategy === 'native'
    ? { kind: 'native' }
    : strategy === 'flat'
      ? { kind: 'flat', text: last.memory_accepted }
      : { kind: 'structured', entries: JSON.parse(last.memory_accepted) };
  s.lastPrediction = last.prediction; s.lastExpect = last.expect; s.memoryRejected = last.memory_update_rejected;
  s.roomDeaths = deathsIn(last.level);
  const roomChanged = last.level_complete || last.level_step >= budget;
  s.lastAction = lastActionOf({
    button: last.button, before: last.researcher.entity_before, after: last.researcher.entity_after,
    path: last.researcher.path, roomChanged,
  });
  if (roomChanged) {
    s.previousRoom = {
      room_index: last.level, outcome: last.level_complete ? 'ended_by_action' : 'actions_exhausted', final_action: s.lastAction,
    };
    s.levelIndex++; s.levelStep = 0; s.roomDeaths = 0; s.lastAction = null;
    if (s.levelIndex < LEVELS.length) s.entity = { ...LEVELS[s.levelIndex].start };
    // The runner applies a swap in the same synchronous stretch as the press
    // that ended the room before it, so a log cannot end between the two. If
    // it somehow has, refuse rather than guess which rules are in force.
    const due = s.levelIndex + 1;
    if (condition !== 'stable' && INTERVENTIONS_BEFORE_LEVELS.includes(due) &&
        !records.some((r) => r.type === 'intervention' && r.before_level === due))
      throw new Error(`log ends on entry to room ${due} without the intervention record due there`);
  }
  // A rejected reply after the last press leaves its error for the next prompt
  // and clears the memory notice, exactly as the loop below does.
  const rejected = records.slice(records.lastIndexOf(last) + 1).filter((r) => r.type === 'invalid_reply').at(-1);
  if (rejected) { s.lastInvalid = rejected.error; s.memoryRejected = null; }
  return s;
}

/** The observation and the prompt for the next press, from the state alone. */
export function promptFor(s: State) {
  const level = LEVELS[s.levelIndex];
  const notice =
    s.condition === 'notified' && INTERVENTIONS_BEFORE_LEVELS.includes(s.levelIndex + 1) && s.levelStep === 0
      ? CHANGE_NOTICE
      : undefined;
  const obs = buildObservation({
    level, roomIndex: s.levelIndex + 1, state: s.entity, lastAction: s.lastAction,
    actionsUsed: s.levelStep, actionsRemaining: s.budget - s.levelStep,
    previousRoom: s.previousRoom ?? undefined, notice,
  });
  const leaks = auditForLeaks(obs);
  if (leaks.length) throw new Error(`observation leaked: ${leaks.join(', ')}`);
  const memIn = renderMemory(s.memory);
  const user = userPrompt({
    observation: obs, memory: s.memory, stepNumber: s.globalStep + 1,
    memoryRejected: s.memoryRejected, lastInvalid: s.lastInvalid,
    lastPrediction: s.lastPrediction, lastExpect: s.lastExpect,
  });
  return { obs, memIn, user };
}

async function main() {
  if (!P.hasKey) {
    console.error(
      'No model reachable. Set one of:\n' +
        '  OPENROUTER_API_KEY=sk-or-...        OpenRouter (endpoint implied)\n' +
        '  ANTHROPIC_API_KEY=sk-ant-...        Anthropic direct\n' +
        '  AURA_ENDPOINT + AURA_API_KEY        any OpenAI-compatible server\n' +
        '  AURA_PROVIDER=codex                 codex exec, sealed\n' +
        'Choose the model with AURA_MODEL. Nothing was run.',
    );
    process.exit(1);
  }
  console.log(`provider       ${P.label}`);
  // A variant schedule or ablation is allowed, but only one the rooms can
  // carry: nothing hazard-free may be played swapped, and every room from the
  // first change on must be finishable under both regimes.
  if (process.env.AURA_INTERVENTIONS) {
    const first = INTERVENTIONS_BEFORE_LEVELS[0];
    if (!first || first <= Math.max(...NO_HAZARD_LEVELS))
      throw new Error(`AURA_INTERVENTIONS=${process.env.AURA_INTERVENTIONS}: the first change must come after room ${Math.max(...NO_HAZARD_LEVELS)}`);
    for (const lv of LEVELS.filter((l) => l.id >= first))
      if (!solve(lv, DEFAULT_RULES) || !solve(lv, CHANGED_RULES))
        throw new Error(`room ${lv.id} is not finishable under both regimes; the schedule ${INTERVENTIONS_BEFORE_LEVELS.join(',')} cannot be played`);
    console.log(`schedule       changes before rooms ${INTERVENTIONS_BEFORE_LEVELS.join(', ')} (variant)`);
  }
  if (OBSERVATION_ABLATIONS.length) console.log(`ablation       withheld from the observation: ${OBSERVATION_ABLATIONS.join(', ')}`);
  if (STRATEGY === 'native' && P.provider !== 'codex')
    throw new Error('the native strategy is the subject keeping its own conversation; only the codex provider can do that');
  // One persisted conversation for the whole run. Its id is recorded on every
  // press, so a resumed campaign resumes the same conversation.
  const session: CodexSession | undefined =
    STRATEGY === 'native'
      ? { id: prior.filter((r) => r.type === 'step').at(-1)?.call?.thread_id ?? null,
          dir: path.join(os.tmpdir(), `aura-native-${RUN_ID}`) }
      : undefined;
  if (session?.id) console.log(`conversation   ${session.id} (resumed)`);

  const system = systemPrompt(STRATEGY);
  const resumedAfter: number[] = prior.filter((r) => r.type === 'run_resume').map((r) => r.from_global_step);
  let s: State;
  let sealBroken = prior.some((r) => r.type === 'seal_alarm' && r.leaky);
  if (priorStart) {
    if (priorStart.provider !== P.provider || priorStart.model !== P.model)
      throw new Error(
        `${RUN_ID} was recorded with ${priorStart.provider} · ${priorStart.model}; ` +
          `the environment now selects ${P.label}. A resumed run keeps its subject.`,
      );
    if (priorStart.system_prompt !== system)
      throw new Error('the system prompt has changed since this log was recorded; resuming would splice two experiments');
    s = hydrate(prior, STRATEGY, CONDITION, BUDGET);
    resumedAfter.push(s.globalStep);
    write({ type: 'run_resume', at: new Date().toISOString(), from_global_step: s.globalStep, prior_records: prior.length });
    console.log(`resuming       ${RUN_ID} after step ${s.globalStep} (room ${s.levelIndex + 1}, ${s.levelStep}/${BUDGET} presses used)`);
  } else {
    s = fresh(STRATEGY, CONDITION, BUDGET);
    write({
      type: 'run_start', at: new Date().toISOString(), engine_version: ENGINE_VERSION,
      config: { runId: RUN_ID, strategy: STRATEGY, condition: CONDITION, driver: 'llm', actionBudgetPerLevel: BUDGET, seed: 0 },
      curriculum: { rooms: LEVELS.length, interventions_before_levels: INTERVENTIONS_BEFORE_LEVELS },
      observation_ablation: OBSERVATION_ABLATIONS,
      provider: P.provider, model: P.model, endpoint: P.endpoint, effort: P.effort,
      system_prompt: system,
    });
  }

  // Each scheduled change toggles the regime, and the regime a room is due to
  // be played under is a function of the room alone — so this is idempotent
  // and a resumed run cannot apply a change twice or skip one.
  const intervene = () => {
    if (s.condition === 'stable') return;
    const level = s.levelIndex + 1;
    const swapped = swappedAt(level);
    if (s.rules.swapped === swapped) return;
    s.rules = { swapped };
    s.interventionAt ??= s.globalStep;
    console.log(`\n  *** RULES ${swapped ? 'SWAPPED' : 'SWAPPED BACK'} on entering room ${level} ***\n`);
    write({ type: 'intervention', at_global_step: s.globalStep, before_level: level, rules_after: s.rules });
  };

  while (s.levelIndex < Math.min(MAX_ROOMS, LEVELS.length)) {
    const level = LEVELS[s.levelIndex];
    const { obs, memIn, user } = promptFor(s);

    // A press is stateless, so asking again after a timeout is the same
    // question, not a second chance. Every failed attempt is still logged.
    let reply: ProviderReply | null = null;
    for (let attempt = 1; attempt <= RETRIES + 1 && !reply; attempt++) {
      try {
        // No explicit cap: the browser runner sends none either, so both get
        // the adapter's default. A lower cap here once truncated a reasoning
        // model's reply mid-JSON (its thinking counts against max_tokens), and
        // the rejection looked like the subject's fault.
        reply = await ask(system, user, { codexSession: session });
      } catch (e: any) {
        console.error(`\nprovider error at step ${s.globalStep + 1}, attempt ${attempt}: ${e.message}`);
        write({ type: 'provider_error', global_step: s.globalStep, attempt, error: String(e.message) });
      }
    }
    if (!reply) break;
    s.usage.calls++; s.usage.input += reply.usage.input; s.usage.output += reply.usage.output;
    if (reply.toolUses) {
      // A sealed subject must not be using tools. If it is, this is no longer an
      // observation about reasoning from the prompt, and the run is not evidence.
      s.toolUseAlarms++;
      const what = (reply.toolItems ?? []).join(', ') || 'unknown item types';
      console.log(`  !! step ${s.globalStep + 1}: subject made ${reply.toolUses} non-message item(s): ${what}`);
      // Only a command or a file touch can actually leak the world. Planning
      // and todo items are noise and must not be reported as a broken seal.
      const leaky = (reply.toolItems ?? []).some((t) => /command|exec|file|read|search|fetch|mcp/i.test(t));
      if (leaky) { sealBroken = true; console.log('     ^^ SEAL BROKEN - this run is not valid evidence'); }
      write({ type: 'seal_alarm', global_step: s.globalStep, tool_uses: reply.toolUses, tool_items: reply.toolItems ?? [], leaky });
    }
    s.memoryRejected = null; s.lastInvalid = null;

    // A rejected reply records the call too: a reply cut off by the token cap
    // (stop_reason 'length') and a reply that was simply malformed are
    // different facts about the subject, and the raw text alone cannot tell them apart.
    const reject = (error: string) => {
      s.invalid++; s.lastInvalid = error;
      write({
        type: 'invalid_reply', global_step: s.globalStep, error, raw: reply!.text.slice(0, 4000),
        call: { model: reply!.model, latency_ms: reply!.latencyMs, stop_reason: reply!.stopReason, usage: reply!.usage },
      });
      console.log(`  step ${s.globalStep + 1}: REJECTED (${error}; stop_reason=${reply!.stopReason}) — no press`);
    };
    let parsed: unknown;
    try { parsed = extractJson(reply.text); }
    catch (e: any) { reject(String(e.message)); continue; }
    const v = validate(parsed, STRATEGY);
    if (!v.ok) { reject(v.error); continue; }

    const applied = applyMemory(s.memory, v.reply.memory);
    s.memoryRejected = applied.rejected;
    s.memory = applied.memory;

    const before = { ...s.entity };
    const r = step(level, before, v.reply.button as Button, s.rules);
    s.entity = r.state; s.globalStep++; s.levelStep++;
    const roomChanged = r.complete || s.levelStep >= BUDGET;
    // the same counterfactual the browser runner records, from the same function
    const both = resolveBoth(level, before, v.reply.button as Button, s.rules, s.levelStep, BUDGET);
    const discriminating = both.divergent.length > 0;
    if (r.died) s.roomDeaths++;
    s.lastPrediction = v.reply.prediction;
    s.lastExpect = v.reply.expect;
    s.previousRoom = null;
    s.lastAction = lastActionOf({
      button: v.reply.button, before, after: r.state, path: r.path, roomChanged,
    });

    const lethal = lethalGlyph(s.rules);
    const originalObjective = goalGlyph(DEFAULT_RULES);
    const touchedLethal = r.path.some((p) => level.grid[p.y][p.x] === lethal);
    const touchedOriginalObjective = r.path.some((p) => level.grid[p.y][p.x] === originalObjective);

    let committed = 0;
    let allRight = true;
    for (const f of PREDICTION_FIELDS) {
      const ok = scoreField(v.reply.expect, both.outcome, f);
      if (ok === null) continue;
      committed++;
      if (!ok) allRight = false;
    }
    const verdict = committed ? allRight : null;

    const record = {
      type: 'step' as const, run_id: RUN_ID, level: s.levelIndex + 1,
      global_step: s.globalStep, level_step: s.levelStep,
      observation_before: obs, prompt_user: user,
      memory_in_prompt: memIn, memory_proposed: renderMemory(v.reply.memory),
      memory_accepted: renderMemory(applied.memory), memory_update_rejected: applied.rejected,
      button: v.reply.button, hypothesis: v.reply.hypothesis, prediction: v.reply.prediction,
      expect: v.reply.expect, contradiction: v.reply.contradiction,
      model_response_raw: reply.text, level_complete: r.complete,
      call: {
        model: reply.model, latency_ms: reply.latencyMs, stop_reason: reply.stopReason,
        usage: reply.usage,
        ...(reply.toolUses === undefined ? {} : { tool_uses: reply.toolUses, tool_items: reply.toolItems ?? [] }),
        ...(reply.scaffoldTokens === undefined ? {} : { scaffold_tokens: reply.scaffoldTokens }),
        ...(reply.threadId === undefined ? {} : { thread_id: reply.threadId }),
        ...(reply.reasoningTokens === undefined ? {} : { reasoning_tokens: reply.reasoningTokens }),
      },
      researcher: {
        true_rules: s.rules, entity_before: before, entity_after: r.state, path: r.path,
        blocked: r.blocked, died: r.died, died_at: r.diedAt, auto_moved: r.autoMoved,
        outcome: both.outcome, outcome_under_other_rules: both.other,
        divergent_fields: both.divergent,
        discriminating_under_rule_change: discriminating,
        intervention_applied: s.interventionAt !== null,
        touched_lethal: touchedLethal, touched_original_objective: touchedOriginalObjective,
        manual_intervention: false,
      },
    };
    s.records.push(record as unknown as StepRecord);
    write(record);

    const mark = verdict === true ? 'HIT ' : verdict === false ? 'MISS' : '  · ';
    const what = r.died ? `SENT BACK from ${r.diedAt!.x},${r.diedAt!.y}`
      : r.blocked ? 'blocked'
      : `${before.x},${before.y} -> ${r.state.x},${r.state.y}${r.complete ? '  ** ROOM SOLVED **' : ''}`;
    console.log(
      `  r${s.levelIndex + 1} s${String(s.globalStep).padStart(3)} ${v.reply.button} ${mark} ${what}` +
        (discriminating ? `   [tells: ${both.divergent.join(',')}]` : ''),
    );
    if (!QUIET && v.reply.contradiction) console.log(`        flags: ${v.reply.contradiction}`);

    if (r.complete || s.levelStep >= BUDGET) {
      s.outcomes.push({ level: s.levelIndex + 1, solved: r.complete, actions: s.levelStep, deaths: s.roomDeaths });
      if (!r.complete) console.log(`  room ${s.levelIndex + 1} FAILED (budget)`);
      s.previousRoom = s.lastAction
        ? { room_index: s.levelIndex + 1, outcome: r.complete ? 'ended_by_action' : 'actions_exhausted', final_action: s.lastAction }
        : null;
      s.levelIndex++; s.levelStep = 0; s.roomDeaths = 0; s.lastAction = null;
      if (s.levelIndex < LEVELS.length) { s.entity = { ...LEVELS[s.levelIndex].start }; intervene(); }
    }
  }

  const m = computeMetrics(s.records);
  const summary = {
    run_id: RUN_ID, engine_version: ENGINE_VERSION,
    provider: P.provider, model: P.model, endpoint: P.endpoint,
    config: { strategy: STRATEGY, condition: CONDITION, budget: BUDGET },
    resumed_after_steps: resumedAfter,
    outcomes: s.outcomes, metrics: m, invalid_replies: s.invalid,
    tool_use_alarms: s.toolUseAlarms, seal_broken: sealBroken, usage: s.usage,
  };
  write({ type: 'run_end', at: new Date().toISOString(), summary });
  fs.writeFileSync(path.join(RUNS, `${RUN_ID}.summary.json`), JSON.stringify(summary, null, 2));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`rooms solved   ${m.roomsSolved}/${Math.min(MAX_ROOMS, LEVELS.length)}`);
  console.log(`presses        ${m.totalActions}   deaths ${m.deaths} (${m.deathsAfterChange} after the change)`);
  console.log(`accuracy       ${m.accuracy === null ? '—' : (m.accuracy * 100).toFixed(0) + '%'}  (${m.fieldsCorrect}/${m.fieldsCommitted} fields, ${m.predictionsDeclined} presses committed nothing)`);
  if (m.hazardContacts.length)
    console.log(`hazard touched ${m.hazardContacts.map((h) => `r${h.level}:${h.presses}${h.deaths ? `(${h.deaths} fatal)` : ''}`).join(' ')}`);
  if (m.interventionAtStep !== null) {
    console.log(`change at      step ${m.interventionAtStep}`);
    console.log(`first evidence ${m.firstEvidenceStep ?? 'never'}`);
    console.log(`R1 revised     ${m.firstRevisedPredictionStep ?? 'NEVER'}   (delay after evidence: ${m.detectionDelay ?? '—'})   strict ${m.firstStrictRevisedPredictionStep ?? 'NEVER'}`);
    console.log(`R2 room after  ${m.postChangeCompletionStep ?? 'NEVER'}`);
    console.log(`RECOVERED      ${m.recovered ? `step ${m.recoveredAtStep}` : 'NO'}   strict ${m.recoveredStrict ? `step ${m.recoveredStrictAtStep}` : 'NO'}`);
    console.log(`transfer       ${m.transferStep === null ? 'NO' : `step ${m.transferStep}`}`);
    console.log(`stale rule     ${m.staleRulePredictions} predictions, ${m.staleRuleActions} actions (${m.staleRuleDeaths} fatal)`);
    console.log(`violations     ${m.ruleRelevantViolations} on altered fields, ${m.predictionViolations} presses overall`);
    if (m.collateralDrop !== null)
      console.log(`collateral     ${(m.collateralDrop * 100).toFixed(0)}pp accuracy drop on fields the change did not touch`);
    if (m.demotedAfterChange.length) console.log(`demoted after  ${m.demotedAfterChange.join(', ')}`);
    for (const c of m.changes.slice(1)) {
      console.log(`--- change ${c.index} (step ${c.atStep}, ${c.rulesAfter.swapped ? 'swapped' : 'back to original'})`);
      console.log(`first evidence ${c.firstEvidenceStep ?? 'never'}   R1 ${c.firstRevisedPredictionStep ?? 'NEVER'} (delay ${c.detectionDelay ?? '—'})   strict R1 ${c.firstStrictRevisedPredictionStep ?? 'NEVER'}   R2 ${c.postChangeCompletionStep ?? 'NEVER'}`);
      console.log(`RECOVERED      ${c.recovered ? `step ${c.recoveredAtStep}` : 'NO'}   strict ${c.recoveredStrict ? `step ${c.recoveredStrictAtStep}` : 'NO'}   transfer ${c.transferStep ?? 'NO'}   deaths ${c.deaths}`);
      console.log(`stale rule     ${c.staleRulePredictions} predictions, ${c.staleRuleActions} actions (${c.staleRuleDeaths} fatal)`);
    }
  }
  console.log(`invalid        ${s.invalid}`);
  // Only a leaky item breaks the seal. The first summary printed SEAL BROKEN
  // for a codex `error` item, which is noise, and called a valid run invalid.
  if (sealBroken) console.log(`SEAL BROKEN    a step ran a command or touched a file - this run is not valid evidence`);
  else if (s.toolUseAlarms) console.log(`non-message    ${s.toolUseAlarms} codex item(s) besides the reply, none leaky - seal intact`);
  if (summary.resumed_after_steps.length) console.log(`resumed after  step ${summary.resumed_after_steps.join(', ')}`);
  console.log(`provider       ${P.label}`);
  console.log(`model calls    ${s.usage.calls}  (${s.usage.input + s.usage.output} tokens)`);
  console.log(`log            ${LOG}`);
}

if (import.meta.main) main().catch((e) => { console.error(e); process.exit(1); });
