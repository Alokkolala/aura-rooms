/**
 * Run a whole campaign headlessly against a real model endpoint.
 *
 *   ANTHROPIC_API_KEY=sk-... npm run campaign
 *   AURA_ENDPOINT=http://localhost:11434/v1 AURA_API_KEY=x AURA_MODEL=llama3.1 npm run campaign
 *
 * Options:
 *   --strategy=flat|structured   (default structured)
 *   --condition=stable|hidden|notified   (default hidden)
 *   --budget=N                   actions per room (default 20)
 *   --rooms=N                    stop after N rooms (default all)
 *   --tag=name                   log file prefix
 *   --quiet                      one line per press instead of the full trace
 *
 * WHY THIS EXISTS. The same protocol can be driven by hand, one model call at a
 * time, and that is how the first runs were done. It is unusable at campaign
 * length: each hand-driven call carried about twenty times more overhead than
 * the work it did, because every call rebuilt an entire agent harness to answer
 * one question about one grid. This script sends exactly the prompt and nothing
 * else, which is both far cheaper and — more importantly — exactly what
 * `src/runner.ts` sends in the browser, so a headless run and a watched run are
 * the same experiment.
 */
import fs from 'node:fs';
import path from 'node:path';

import { CHANGED_RULES, DEFAULT_RULES, goalGlyph, lethalGlyph, step } from '../src/engine/engine.ts';
import { INTERVENTION_BEFORE_LEVEL, LEVELS } from '../src/engine/levels.ts';
import { buildObservation, lastActionOf, auditForLeaks, type LastAction } from '../src/engine/observation.ts';
import { ENGINE_VERSION, type Button, type EntityState, type Rules } from '../src/engine/types.ts';
import { applyMemory, emptyMemory, renderMemory, type Memory, type StrategyName } from '../src/agent/memory.ts';
import { systemPrompt, userPrompt } from '../src/agent/prompt.ts';
import { extractJson, validate, PREDICTION_FIELDS, type Prediction } from '../src/agent/schema.ts';
import { computeMetrics, resolveBoth, scoreField, type StepRecord } from '../src/metrics.ts';
import { ask, providerConfig, type ProviderReply } from '../server/provider.ts';
import { CHANGE_NOTICE } from '../src/runner.ts';

const arg = (k: string, d?: string) =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const flag = (k: string) => process.argv.includes(`--${k}`);

const STRATEGY = (arg('strategy', 'structured') as StrategyName);
const CONDITION = arg('condition', 'hidden') as 'stable' | 'hidden' | 'notified';
const BUDGET = Number(arg('budget', '20'));
const MAX_ROOMS = Number(arg('rooms', String(LEVELS.length)));
const QUIET = flag('quiet');
const RUN_ID = `${arg('tag', 'campaign')}-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;

const RUNS = path.resolve('runs');
fs.mkdirSync(RUNS, { recursive: true });
const LOG = path.join(RUNS, `${RUN_ID}.jsonl`);
const write = (rec: unknown) => fs.appendFileSync(LOG, JSON.stringify(rec) + '\n');

const P = providerConfig();

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

  let levelIndex = 0;
  let entity: EntityState = { ...LEVELS[0].start };
  let rules: Rules = { ...DEFAULT_RULES };
  let memory: Memory = emptyMemory(STRATEGY);
  let globalStep = 0;
  let levelStep = 0;
  let interventionAt: number | null = null;
  let lastAction: LastAction | null = null;
  let lastPrediction: string | null = null;
  let lastExpect: Prediction | null = null;
  let memoryRejected: string | null = null;
  let lastInvalid: string | null = null;
  let previousRoom: any = null;
  let invalid = 0;
  let toolUseAlarms = 0;
  const usage = { input: 0, output: 0, calls: 0 };
  const records: StepRecord[] = [];
  const outcomes: Array<{ level: number; solved: boolean; actions: number; deaths: number }> = [];
  let roomDeaths = 0;

  const system = systemPrompt(STRATEGY);
  write({
    type: 'run_start', at: new Date().toISOString(), engine_version: ENGINE_VERSION,
    config: { runId: RUN_ID, strategy: STRATEGY, condition: CONDITION, driver: 'llm', actionBudgetPerLevel: BUDGET, seed: 0 },
    provider: P.provider, model: P.model, endpoint: P.endpoint, effort: P.effort,
    system_prompt: system,
  });

  const intervene = () => {
    if (CONDITION === 'stable' || interventionAt !== null) return;
    if (levelIndex + 1 !== INTERVENTION_BEFORE_LEVEL) return;
    rules = { ...CHANGED_RULES };
    interventionAt = globalStep;
    console.log(`\n  *** RULE CHANGED on entering room ${INTERVENTION_BEFORE_LEVEL} ***\n`);
    write({ type: 'intervention', at_global_step: globalStep, before_level: INTERVENTION_BEFORE_LEVEL, rules_after: rules });
  };

  while (levelIndex < Math.min(MAX_ROOMS, LEVELS.length)) {
    const level = LEVELS[levelIndex];
    const notice =
      CONDITION === 'notified' && levelIndex + 1 === INTERVENTION_BEFORE_LEVEL && levelStep === 0
        ? CHANGE_NOTICE
        : undefined;
    const obs = buildObservation({
      level, roomIndex: levelIndex + 1, state: entity, lastAction,
      actionsUsed: levelStep, actionsRemaining: BUDGET - levelStep,
      previousRoom: previousRoom ?? undefined, notice,
    });
    const leaks = auditForLeaks(obs);
    if (leaks.length) throw new Error(`observation leaked: ${leaks.join(', ')}`);

    const memIn = renderMemory(memory);
    const user = userPrompt({
      observation: obs, memory, stepNumber: globalStep + 1,
      memoryRejected, lastInvalid, lastPrediction, lastExpect,
    });

    let reply: ProviderReply;
    try {
      reply = await ask(system, user, { maxTokens: 4000 });
    } catch (e: any) {
      console.error(`\nprovider error at step ${globalStep + 1}: ${e.message}`);
      write({ type: 'provider_error', global_step: globalStep, error: String(e.message) });
      break;
    }
    usage.calls++; usage.input += reply.usage.input; usage.output += reply.usage.output;
    if (reply.toolUses) {
      // A sealed subject must not be using tools. If it is, this is no longer an
      // observation about reasoning from the prompt, and the run is not evidence.
      toolUseAlarms++;
      const what = (reply.toolItems ?? []).join(', ') || 'unknown item types';
      console.log(`  !! step ${globalStep + 1}: subject made ${reply.toolUses} non-message item(s): ${what}`);
      // Only a command or a file touch can actually leak the world. Planning
      // and todo items are noise and must not be reported as a broken seal.
      const leaky = (reply.toolItems ?? []).some((t) => /command|exec|file|read|search|fetch|mcp/i.test(t));
      if (leaky) console.log('     ^^ SEAL BROKEN - this run is not valid evidence');
      write({ type: 'seal_alarm', global_step: globalStep, tool_uses: reply.toolUses, tool_items: reply.toolItems ?? [], leaky });
    }
    memoryRejected = null; lastInvalid = null;

    let parsed: unknown;
    try { parsed = extractJson(reply.text); }
    catch (e: any) {
      invalid++; lastInvalid = String(e.message);
      write({ type: 'invalid_reply', global_step: globalStep, error: lastInvalid, raw: reply.text.slice(0, 4000) });
      console.log(`  step ${globalStep + 1}: REJECTED (${lastInvalid}) — no press`);
      continue;
    }
    const v = validate(parsed, STRATEGY);
    if (!v.ok) {
      invalid++; lastInvalid = v.error;
      write({ type: 'invalid_reply', global_step: globalStep, error: v.error, raw: reply.text.slice(0, 4000) });
      console.log(`  step ${globalStep + 1}: REJECTED (${v.error}) — no press`);
      continue;
    }

    const applied = applyMemory(memory, v.reply.memory);
    memoryRejected = applied.rejected;
    memory = applied.memory;

    const before = { ...entity };
    const r = step(level, before, v.reply.button as Button, rules);
    entity = r.state; globalStep++; levelStep++;
    const roomChanged = r.complete || levelStep >= BUDGET;
    // the same counterfactual the browser runner records, from the same function
    const both = resolveBoth(level, before, v.reply.button as Button, rules, levelStep, BUDGET);
    const discriminating = both.divergent.length > 0;
    if (r.died) roomDeaths++;
    lastPrediction = v.reply.prediction;
    lastExpect = v.reply.expect;
    previousRoom = null;
    lastAction = lastActionOf({
      button: v.reply.button, before, after: r.state, path: r.path, roomChanged,
    });

    const lethal = lethalGlyph(rules);
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
      type: 'step' as const, run_id: RUN_ID, level: levelIndex + 1,
      global_step: globalStep, level_step: levelStep,
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
      },
      researcher: {
        true_rules: rules, entity_before: before, entity_after: r.state, path: r.path,
        blocked: r.blocked, died: r.died, died_at: r.diedAt, auto_moved: r.autoMoved,
        outcome: both.outcome, outcome_under_other_rules: both.other,
        divergent_fields: both.divergent,
        discriminating_under_rule_change: discriminating,
        intervention_applied: interventionAt !== null,
        touched_lethal: touchedLethal, touched_original_objective: touchedOriginalObjective,
        manual_intervention: false,
      },
    };
    records.push(record as unknown as StepRecord);
    write(record);

    const mark = verdict === true ? 'HIT ' : verdict === false ? 'MISS' : '  · ';
    const what = r.died ? `SENT BACK from ${r.diedAt!.x},${r.diedAt!.y}`
      : r.blocked ? 'blocked'
      : `${before.x},${before.y} -> ${r.state.x},${r.state.y}${r.complete ? '  ** ROOM SOLVED **' : ''}`;
    console.log(
      `  r${levelIndex + 1} s${String(globalStep).padStart(3)} ${v.reply.button} ${mark} ${what}` +
        (discriminating ? `   [tells: ${both.divergent.join(',')}]` : ''),
    );
    if (!QUIET && v.reply.contradiction) console.log(`        flags: ${v.reply.contradiction}`);

    if (r.complete || levelStep >= BUDGET) {
      outcomes.push({ level: levelIndex + 1, solved: r.complete, actions: levelStep, deaths: roomDeaths });
      if (!r.complete) console.log(`  room ${levelIndex + 1} FAILED (budget)`);
      previousRoom = lastAction
        ? { room_index: levelIndex + 1, outcome: r.complete ? 'ended_by_action' : 'actions_exhausted', final_action: lastAction }
        : null;
      levelIndex++; levelStep = 0; roomDeaths = 0; lastAction = null;
      if (levelIndex < LEVELS.length) { entity = { ...LEVELS[levelIndex].start }; intervene(); }
    }
  }

  const m = computeMetrics(records);
  const summary = {
    run_id: RUN_ID, engine_version: ENGINE_VERSION,
    provider: P.provider, model: P.model, endpoint: P.endpoint,
    config: { strategy: STRATEGY, condition: CONDITION, budget: BUDGET },
    outcomes, metrics: m, invalid_replies: invalid, tool_use_alarms: toolUseAlarms, usage,
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
    console.log(`R1 revised     ${m.firstRevisedPredictionStep ?? 'NEVER'}   (delay after evidence: ${m.detectionDelay ?? '—'})`);
    console.log(`R2 room after  ${m.postChangeCompletionStep ?? 'NEVER'}`);
    console.log(`RECOVERED      ${m.recovered ? `step ${m.recoveredAtStep}` : 'NO'}`);
    console.log(`transfer       ${m.transferStep === null ? 'NO' : `step ${m.transferStep}`}`);
    console.log(`stale rule     ${m.staleRulePredictions} predictions, ${m.staleRuleActions} actions (${m.staleRuleDeaths} fatal)`);
    console.log(`violations     ${m.ruleRelevantViolations} on altered fields, ${m.predictionViolations} presses overall`);
    if (m.collateralDrop !== null)
      console.log(`collateral     ${(m.collateralDrop * 100).toFixed(0)}pp accuracy drop on fields the change did not touch`);
    if (m.demotedAfterChange.length) console.log(`demoted after  ${m.demotedAfterChange.join(', ')}`);
  }
  console.log(`invalid        ${invalid}`);
  if (toolUseAlarms)
    console.log(`SEAL BROKEN    ${toolUseAlarms} step(s) used tools - this run is not valid evidence`);
  console.log(`provider       ${P.label}`);
  console.log(`model calls    ${usage.calls}  (${usage.input + usage.output} tokens)`);
  console.log(`log            ${LOG}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
