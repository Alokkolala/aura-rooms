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

import { CHANGED_RULES, DEFAULT_RULES, step } from '../src/engine/engine.ts';
import { INTERVENTION_BEFORE_LEVEL, LEVELS } from '../src/engine/levels.ts';
import { buildObservation, pose, auditForLeaks, type LastAction } from '../src/engine/observation.ts';
import { ENGINE_VERSION, type Button, type EntityState, type Rules } from '../src/engine/types.ts';
import { applyMemory, emptyMemory, renderMemory, type Memory, type StrategyName } from '../src/agent/memory.ts';
import { systemPrompt, userPrompt } from '../src/agent/prompt.ts';
import { extractJson, validate } from '../src/agent/schema.ts';
import { computeMetrics, type StepRecord } from '../src/metrics.ts';

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

const MODEL = process.env.AURA_MODEL || 'claude-opus-5';
const ENDPOINT = process.env.AURA_ENDPOINT || '';
const EFFORT = process.env.AURA_EFFORT || 'medium';

interface Reply { text: string; usage: { input: number; output: number } }

async function ask(system: string, user: string): Promise<Reply> {
  if (ENDPOINT) {
    const res = await fetch(`${ENDPOINT.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.AURA_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 400)}`);
    const j: any = await res.json();
    return {
      text: j.choices?.[0]?.message?.content ?? '',
      usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0 },
    };
  }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT as 'low' | 'medium' | 'high' },
    messages: [{ role: 'user', content: user }],
  });
  return {
    text: res.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text).join(''),
    usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
  };
}

async function main() {
  if (!ENDPOINT && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      'No model reachable. Set ANTHROPIC_API_KEY, or AURA_ENDPOINT + AURA_API_KEY for any\n' +
        'OpenAI-compatible server (Ollama, LM Studio, vLLM). Nothing was run.',
    );
    process.exit(1);
  }

  let levelIndex = 0;
  let entity: EntityState = { ...LEVELS[0].start };
  let rules: Rules = { ...DEFAULT_RULES };
  let memory: Memory = emptyMemory(STRATEGY);
  let globalStep = 0;
  let levelStep = 0;
  let interventionAt: number | null = null;
  let lastAction: LastAction | null = null;
  let lastPrediction: string | null = null;
  let memoryRejected: string | null = null;
  let lastInvalid: string | null = null;
  let previousRoom: any = null;
  let invalid = 0;
  const usage = { input: 0, output: 0, calls: 0 };
  const records: StepRecord[] = [];
  const outcomes: Array<{ level: number; solved: boolean; actions: number; deaths: number }> = [];
  let roomDeaths = 0;

  const system = systemPrompt(STRATEGY);
  write({
    type: 'run_start', at: new Date().toISOString(), engine_version: ENGINE_VERSION,
    config: { runId: RUN_ID, strategy: STRATEGY, condition: CONDITION, driver: 'llm', actionBudgetPerLevel: BUDGET, seed: 0 },
    model: MODEL, system_prompt: system,
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
        ? 'One of the rules of this world has changed.'
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
      memoryRejected, lastInvalid, lastPrediction,
    });

    let reply: Reply;
    try {
      reply = await ask(system, user);
    } catch (e: any) {
      console.error(`\nprovider error at step ${globalStep + 1}: ${e.message}`);
      write({ type: 'provider_error', global_step: globalStep, error: String(e.message) });
      break;
    }
    usage.calls++; usage.input += reply.usage.input; usage.output += reply.usage.output;
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
    const a = step(level, before, v.reply.button as Button, DEFAULT_RULES);
    const b = step(level, before, v.reply.button as Button, CHANGED_RULES);
    const discriminating =
      JSON.stringify(a.state) !== JSON.stringify(b.state) || a.complete !== b.complete || a.died !== b.died;

    const r = step(level, before, v.reply.button as Button, rules);
    entity = r.state; globalStep++; levelStep++;
    if (r.died) roomDeaths++;
    lastPrediction = v.reply.prediction;
    previousRoom = null;
    lastAction = {
      button: v.reply.button, before: pose(before), after: pose(r.state),
      level_complete: r.complete, ...(r.died ? { died: true, died_at: r.diedAt ?? undefined } : {}),
    };

    const verdict = v.reply.predicted_position
      ? v.reply.predicted_position.x === r.state.x && v.reply.predicted_position.y === r.state.y
      : null;

    const record = {
      type: 'step' as const, run_id: RUN_ID, level: levelIndex + 1,
      global_step: globalStep, level_step: levelStep,
      observation_before: obs, prompt_user: user,
      memory_in_prompt: memIn, memory_proposed: renderMemory(v.reply.memory),
      memory_accepted: renderMemory(applied.memory), memory_update_rejected: applied.rejected,
      button: v.reply.button, hypothesis: v.reply.hypothesis, prediction: v.reply.prediction,
      predicted_position: v.reply.predicted_position, contradiction: v.reply.contradiction,
      model_response_raw: reply.text, level_complete: r.complete,
      researcher: {
        true_rules: rules, entity_before: before, entity_after: r.state, path: r.path,
        blocked: r.blocked, died: r.died, died_at: r.diedAt, auto_moved: r.autoMoved,
        discriminating_under_rule_change: discriminating,
        intervention_applied: interventionAt !== null, manual_intervention: false,
      },
    };
    records.push(record as unknown as StepRecord);
    write(record);

    const mark = verdict === true ? 'HIT ' : verdict === false ? 'MISS' : '  · ';
    const what = r.died ? `DIED at ${r.diedAt!.x},${r.diedAt!.y}`
      : r.blocked ? 'blocked'
      : `${before.x},${before.y} -> ${r.state.x},${r.state.y}${r.complete ? '  ** ROOM COMPLETE **' : ''}`;
    console.log(`  r${levelIndex + 1} s${String(globalStep).padStart(3)} ${v.reply.button} ${mark} ${what}`);
    if (!QUIET && v.reply.contradiction) console.log(`        flags: ${v.reply.contradiction}`);

    if (r.complete || levelStep >= BUDGET) {
      outcomes.push({ level: levelIndex + 1, solved: r.complete, actions: levelStep, deaths: roomDeaths });
      if (!r.complete) console.log(`  room ${levelIndex + 1} FAILED (budget)`);
      previousRoom = lastAction
        ? { room_index: levelIndex + 1, outcome: r.complete ? 'completed' : 'ran_out_of_actions', final_action: lastAction }
        : null;
      levelIndex++; levelStep = 0; roomDeaths = 0; lastAction = null;
      if (levelIndex < LEVELS.length) { entity = { ...LEVELS[levelIndex].start }; intervene(); }
    }
  }

  const m = computeMetrics(records);
  const summary = {
    run_id: RUN_ID, engine_version: ENGINE_VERSION, model: MODEL,
    config: { strategy: STRATEGY, condition: CONDITION, budget: BUDGET },
    outcomes, metrics: m, invalid_replies: invalid, usage,
  };
  write({ type: 'run_end', at: new Date().toISOString(), summary });
  fs.writeFileSync(path.join(RUNS, `${RUN_ID}.summary.json`), JSON.stringify(summary, null, 2));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`rooms solved   ${m.roomsSolved}/${Math.min(MAX_ROOMS, LEVELS.length)}`);
  console.log(`presses        ${m.totalActions}   deaths ${m.deaths} (${m.deathsAfterChange} after the change)`);
  console.log(`accuracy       ${m.accuracy === null ? '—' : (m.accuracy * 100).toFixed(0) + '%'}  (${m.predictionsCorrect}/${m.predictionsCommitted} committed, ${m.predictionsDeclined} declined)`);
  if (m.interventionAtStep !== null) {
    console.log(`change at      step ${m.interventionAtStep}`);
    console.log(`first telling  ${m.firstTellingStep ?? 'never'}`);
    console.log(`recovered      ${m.recoveredAtStep ?? 'NOT RECOVERED'}`);
    console.log(`missed chances ${m.tellingPressesBeforeRecovery}`);
    if (m.demotedAfterChange.length) console.log(`demoted after  ${m.demotedAfterChange.join(', ')}`);
  }
  console.log(`invalid        ${invalid}`);
  console.log(`model calls    ${usage.calls}  (${usage.input + usage.output} tokens)`);
  console.log(`log            ${LOG}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
