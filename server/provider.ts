import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The model adapters, in one place.
 *
 * The dev server and the headless campaign runner both need to reach a model,
 * and they used to carry separate copies of that code. Two copies of "how do we
 * talk to a provider" is two places for a subtle difference to hide — a
 * different max_tokens, a different way of handling an error — and the whole
 * value of the headless runner is that a headless run and a watched run are the
 * same experiment. One module, both callers.
 *
 * THREE PROVIDERS, AND THEY ARE NOT EQUIVALENT SUBJECTS.
 *
 * `anthropic` and `openai-compatible` send a system prompt and a user prompt to
 * a bare model and get text back. `codex` drives an agent CLI, and that is a
 * materially different subject: it has no system/user split, so the two halves
 * are concatenated, and it arrives wrapped in roughly eleven thousand tokens of
 * its own scaffolding before it ever sees the prompt. Every codex reply records
 * `scaffold_tokens` and `tool_uses` so that difference is visible in the log
 * rather than implied. Do not pool a codex arm with an API arm without saying
 * so out loud.
 */

/**
 * Load `.env` if there is one, before anything reads the environment.
 *
 * Credentials should not have to be typed into a shell on every run: that puts
 * them in shell history, in the process list, and in whatever scrollback
 * happens to be shared. `.env` is already gitignored. Values already present in
 * the real environment win, so an explicit `OPENROUTER_API_KEY=... npm run dev`
 * still overrides the file.
 */
try {
  const before = new Set(Object.keys(process.env));
  const saved = new Map([...before].map((k) => [k, process.env[k]]));
  process.loadEnvFile('.env');
  for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
} catch {
  // no .env, or an unreadable one. Neither is an error.
}

export type ProviderName = 'anthropic' | 'openai-compatible' | 'codex';

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  /** base URL for openai-compatible; '' otherwise */
  endpoint: string;
  effort: string;
  hasKey: boolean;
  /** human-readable, safe to show in the UI — never contains a key */
  label: string;
}

export interface ProviderUsage {
  input: number;
  output: number;
  cacheRead: number;
}

export interface ProviderReply {
  text: string;
  model: string;
  stopReason: string | null;
  usage: ProviderUsage;
  latencyMs: number;
  /** codex only: agent items that were not the final message */
  toolUses?: number;
  /** codex only: what those items were, so an alarm can be diagnosed */
  toolItems?: string[];
  /** codex only: tokens the agent harness spent before reaching our prompt */
  scaffoldTokens?: number;
}

const OPENROUTER = 'https://openrouter.ai/api/v1';

/**
 * Resolve which provider to use, from the environment alone.
 *
 * Deliberately not a runtime setting. Which model answered is a property of an
 * experiment, and an experiment whose subject can be swapped from a dropdown
 * mid-run produces a log that cannot say what it measured.
 */
export function providerConfig(): ProviderConfig {
  const forced = (process.env.AURA_PROVIDER || '').toLowerCase();
  const openrouterKey = process.env.OPENROUTER_API_KEY || '';
  const explicitEndpoint = process.env.AURA_ENDPOINT || '';
  const effort = process.env.AURA_EFFORT || 'medium';

  if (forced === 'codex') {
    const model = process.env.AURA_MODEL || 'gpt-5.6-luna';
    return {
      provider: 'codex',
      model,
      endpoint: '',
      effort,
      // codex carries its own auth; there is no key for us to check
      hasKey: true,
      label: `codex exec · ${model}`,
    };
  }

  // OPENROUTER_API_KEY alone is enough — the endpoint is implied.
  const endpoint = explicitEndpoint || (openrouterKey ? OPENROUTER : '');
  if (endpoint) {
    const model = process.env.AURA_MODEL || 'anthropic/claude-sonnet-5';
    const key = process.env.AURA_API_KEY || openrouterKey;
    const host = endpoint.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return {
      provider: 'openai-compatible',
      model,
      endpoint,
      effort,
      hasKey: Boolean(key),
      label: `${host} · ${model}`,
    };
  }

  const model = process.env.AURA_MODEL || 'claude-opus-5';
  return {
    provider: 'anthropic',
    model,
    endpoint: '',
    effort,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    label: `anthropic · ${model}`,
  };
}

function apiKey(): string {
  return process.env.AURA_API_KEY || process.env.OPENROUTER_API_KEY || '';
}

/** Anthropic Messages API via the official SDK. */
async function callAnthropic(
  system: string,
  user: string,
  maxTokens: number,
  c: ProviderConfig,
): Promise<Omit<ProviderReply, 'latencyMs'>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const res = await client.messages.create({
    model: c.model,
    max_tokens: maxTokens,
    system,
    thinking: { type: 'adaptive' },
    output_config: { effort: c.effort as 'low' | 'medium' | 'high' },
    messages: [{ role: 'user', content: user }],
  });
  return {
    text: res.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join(''),
    model: res.model,
    stopReason: res.stop_reason,
    usage: {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
    },
  };
}

/** Any OpenAI-compatible chat/completions endpoint, OpenRouter included. */
async function callOpenAICompatible(
  system: string,
  user: string,
  maxTokens: number,
  c: ProviderConfig,
): Promise<Omit<ProviderReply, 'latencyMs'>> {
  const isOpenRouter = c.endpoint.includes('openrouter.ai');
  const res = await fetch(`${c.endpoint.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey()}`,
      // OpenRouter attributes traffic by these; harmless elsewhere.
      ...(isOpenRouter
        ? { 'HTTP-Referer': 'https://github.com/Alokkolala/aura-rooms', 'X-Title': 'AURA Rooms' }
        : {}),
    },
    body: JSON.stringify({
      model: c.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body}`.slice(0, 800));

  let j: any;
  try {
    j = JSON.parse(body);
  } catch {
    throw new Error(`provider returned non-JSON: ${body.slice(0, 400)}`);
  }

  // OpenRouter answers 200 with an error object when a model is unavailable,
  // rate-limited or moderated. Treated as success, that becomes an empty reply
  // and lands in the log as "the agent said nothing", which is a fabricated
  // observation about the subject.
  if (j.error) {
    const e = j.error;
    throw new Error(`provider error ${e.code ?? ''}: ${e.message ?? JSON.stringify(e)}`.slice(0, 800));
  }
  const choice = j.choices?.[0];
  if (!choice) throw new Error(`provider returned no choices: ${body.slice(0, 400)}`);

  return {
    text: choice.message?.content ?? '',
    model: j.model ?? c.model,
    stopReason: choice.finish_reason ?? null,
    usage: {
      input: j.usage?.prompt_tokens ?? 0,
      output: j.usage?.completion_tokens ?? 0,
      cacheRead: j.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
}

/**
 * Flags that seal the codex subject.
 *
 * An agent that can read this repository can open `src/engine/levels.ts` and
 * look up which surface ends a room. That does not make the experiment hard, it
 * makes it theatre. So:
 *
 *   --sandbox read-only    no writes, no network
 *   -C <empty temp dir>    its working root holds nothing; never the repo
 *   --skip-git-repo-check  because that directory is not a repo
 *   --ignore-user-config   ~/.codex/config.toml is not loaded. Without this the
 *                          operator's own instructions and skills become an
 *                          uncontrolled variable inside the subject.
 *   --ignore-rules         likewise for execpolicy rules
 *   --ephemeral            no session files, so one press cannot see the last
 *
 * The last one matters most for the protocol: every press must be answered from
 * the prompt and the memory store alone. A persisted session would give the
 * codex arm a conversation history the API arms do not have, and "what the
 * agent knows" would stop being "what is in its memory".
 *
 * Reading elsewhere on disk is still physically possible under `read-only`, so
 * it is checked rather than assumed: every reply reports `tool_uses`, and a
 * non-zero count on a sealed subject is a finding, not a detail.
 */
export function codexArgs(model: string, dir: string, outFile: string): string[] {
  return [
    'exec',
    '-m', model,
    '--sandbox', 'read-only',
    '-C', dir,
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--json',
    '-o', outFile,
  ];
}

/** The same flags, with paths quoted, as actually handed to the process. */
function codexArgv(model: string, dir: string, outFile: string): string[] {
  return codexArgs(model, dir, outFile).map((a) => (a === dir || a === outFile ? q(a) : a));
}

export interface CodexEventSummary {
  text: string;
  toolUses: number;
  /**
   * The item types behind `toolUses`, in order.
   *
   * The count alone was useless the first time it fired: the log said the
   * sealed subject had done SOMETHING other than answer, and nothing anywhere
   * recorded what. `command_execution` would mean the seal is broken and the
   * run is not evidence; a planning or todo item means nothing at all. Those
   * two need completely different responses and the instrument could not tell
   * them apart.
   */
  toolItems: string[];
  usage: ProviderUsage;
  scaffoldTokens: number;
}

/** Parse codex's JSONL event stream. Exported so a test can pin the shape. */
export function summariseCodexEvents(jsonl: string, promptChars: number): CodexEventSummary {
  let text = '';
  let toolUses = 0;
  const toolItems: string[] = [];
  const usage: ProviderUsage = { input: 0, output: 0, cacheRead: 0 };

  for (const line of jsonl.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let d: any;
    try {
      d = JSON.parse(t);
    } catch {
      continue; // codex may interleave non-JSON noise; it is not an event
    }
    if (d.type === 'item.completed' && d.item) {
      if (d.item.type === 'agent_message') text = d.item.text ?? text;
      else if (d.item.type !== 'reasoning') {
        toolUses++;
        toolItems.push(String(d.item.type ?? 'unknown'));
      }
    }
    if (d.type === 'turn.completed' && d.usage) {
      usage.input = d.usage.input_tokens ?? 0;
      usage.output = d.usage.output_tokens ?? 0;
      usage.cacheRead = d.usage.cached_input_tokens ?? 0;
    }
  }
  // Rough, and labelled as rough: ~4 chars per token. It exists to make the
  // size of the agent harness wrapped around the subject visible at a glance,
  // not to be precise.
  const scaffoldTokens = Math.max(0, usage.input - Math.round(promptChars / 4));
  return { text, toolUses, toolItems, usage, scaffoldTokens };
}

/**
 * Run a command, feeding it the prompt on stdin.
 *
 * The prompt is NOT an argv element, and that is not a style choice. On Windows
 * `codex` is a `.cmd` shim, which Node will only launch with `shell: true` —
 * and with the shell enabled Node concatenates argv with spaces and no
 * escaping. An AURA prompt is several kilobytes of JSON containing quotes,
 * braces and newlines; as an argument it would be mangled at best. codex reads
 * its instructions from stdin when none is given as an argument, which sidesteps
 * the quoting question entirely rather than trying to win it.
 *
 * The remaining arguments are flags and paths, and the paths are quoted for the
 * same reason — a temp directory containing a space would otherwise split.
 */
function run(
  cmd: string,
  args: string[],
  stdin: string,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // On Windows `codex` is a .cmd shim, and Node refuses to launch .cmd/.bat
    // without a shell. With the shell on, Node logs DEP0190 because it
    // concatenates argv without escaping — which is why the prompt goes over
    // stdin and the only arguments left are fixed flags and paths this module
    // generated inside os.tmpdir().
    //
    // Point AURA_CODEX_BIN at the package's own entrypoint (e.g.
    // .../node_modules/@openai/codex/bin/codex.js) to skip the shell entirely
    // and silence the warning.
    const useNode = cmd.endsWith('.js');
    const child = useNode
      ? spawn(process.execPath, [cmd, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(cmd, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
        });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`codex exec timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    child.stdin.on('error', () => {}); // the child may exit before we finish writing
    child.stdin.end(stdin);
  });
}

/** Quote a path for the shell Node uses when `shell: true` is required. */
function q(p: string): string {
  const viaNode = (process.env.AURA_CODEX_BIN || '').endsWith('.js');
  return process.platform === 'win32' && !viaNode ? `"${p}"` : p;
}

async function callCodex(
  system: string,
  user: string,
  c: ProviderConfig,
  timeoutMs: number,
): Promise<Omit<ProviderReply, 'latencyMs'>> {
  // A fresh empty directory per press. Never the repository.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-seal-'));
  const outFile = path.join(dir, 'reply.txt');
  // codex has no system/user split, so the two are concatenated. The separator
  // is inert punctuation and names nothing about the world.
  const prompt = `${system}\n\n----\n\n${user}`;
  try {
    const r = await run(
      process.env.AURA_CODEX_BIN || 'codex',
      codexArgv(c.model, dir, outFile),
      prompt,
      timeoutMs,
    );
    const events = r.stdout;
    const summary = summariseCodexEvents(events, prompt.length);
    const fromFile = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    const text = fromFile.trim() || summary.text;
    if (!text)
      throw new Error(
        `codex exec produced no message (exit ${r.code}): ${(r.stderr || events).slice(0, 500)}`,
      );
    return {
      text,
      model: c.model,
      stopReason: r.code === 0 ? 'stop' : `exit_${r.code}`,
      usage: summary.usage,
      toolUses: summary.toolUses,
      toolItems: summary.toolItems,
      scaffoldTokens: summary.scaffoldTokens,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * One model call.
 *
 * A failure is returned as a failure. A fabricated reply would be
 * indistinguishable from a real one in the transcript, which is the one thing
 * an experiment log must never contain.
 */
/**
 * The configuration one call will actually use.
 *
 * Separated out and exported because this function alone decides WHICH MODEL
 * ANSWERED, and that is the single fact a run log must not get wrong. A UI that
 * shows one model while another answers produces data that is simply false, and
 * nothing downstream can detect it.
 */
export function resolveConfig(model?: string): ProviderConfig {
  const base = providerConfig();
  if (!model || model === base.model) return base;
  return { ...base, model, label: base.label.replace(base.model, model) };
}

export async function ask(
  system: string,
  user: string,
  opts: { maxTokens?: number; timeoutMs?: number; model?: string } = {},
): Promise<ProviderReply> {
  // A per-call model override exists so the model can be typed into the UI
  // rather than only set in the environment. It is NOT a live dial: the caller
  // fixes it when a run is created and it is recorded in `run_start`, because a
  // log whose subject changed halfway through describes two experiments.
  const c = resolveConfig(opts.model);
  const maxTokens = opts.maxTokens ?? 8000;
  // One knob for both callers. A stalled call is killed, logged, and asked again.
  const timeoutMs = opts.timeoutMs ?? (Number(process.env.AURA_TIMEOUT_MS) || 300_000);
  const t0 = Date.now();
  const out =
    c.provider === 'codex'
      ? await callCodex(system, user, c, timeoutMs)
      : c.provider === 'openai-compatible'
      ? await callOpenAICompatible(system, user, maxTokens, c)
      : await callAnthropic(system, user, maxTokens, c);
  return { ...out, latencyMs: Date.now() - t0 };
}
