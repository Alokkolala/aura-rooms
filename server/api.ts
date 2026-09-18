import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Dev-server middleware: the model adapter and the run log.
 *
 * There is deliberately no second process. The API key is read here, in Node,
 * and never reaches the browser, git, or an exported log. When the provider
 * fails, the failure is returned as a failure — a fabricated agent reply would
 * be indistinguishable from a real one in the transcript, which is the one
 * thing an experiment log must never contain.
 */

const RUNS = path.resolve('runs');

interface AgentRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c: Buffer) => {
      b += c;
      if (b.length > 4_000_000) reject(new Error('request too large'));
    });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

function send(res: any, code: number, body: unknown) {
  const s = JSON.stringify(body);
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(s);
}

function config() {
  return {
    model: process.env.AURA_MODEL || 'claude-opus-5',
    effort: process.env.AURA_EFFORT || 'medium',
    endpoint: process.env.AURA_ENDPOINT || '',
    hasKey: Boolean(
      process.env.AURA_ENDPOINT ? process.env.AURA_API_KEY : process.env.ANTHROPIC_API_KEY,
    ),
  };
}

/** Anthropic Messages API via the official SDK. */
async function callAnthropic(body: AgentRequest) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const c = config();
  const res = await client.messages.create({
    model: c.model,
    max_tokens: body.maxTokens ?? 8000,
    system: body.system,
    thinking: { type: 'adaptive' },
    output_config: { effort: c.effort as 'low' | 'medium' | 'high' },
    messages: [{ role: 'user', content: body.user }],
  });
  const text = res.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return {
    text,
    model: res.model,
    stopReason: res.stop_reason,
    usage: {
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
    },
  };
}

/** Any OpenAI-compatible chat/completions endpoint. */
async function callOpenAICompatible(body: AgentRequest) {
  const c = config();
  const res = await fetch(`${c.endpoint.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.AURA_API_KEY}`,
    },
    body: JSON.stringify({
      model: c.model,
      max_tokens: body.maxTokens ?? 8000,
      messages: [
        { role: 'system', content: body.system },
        { role: 'user', content: body.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`.slice(0, 600));
  const j: any = await res.json();
  return {
    text: j.choices?.[0]?.message?.content ?? '',
    model: j.model ?? c.model,
    stopReason: j.choices?.[0]?.finish_reason ?? null,
    usage: {
      input: j.usage?.prompt_tokens ?? 0,
      output: j.usage?.completion_tokens ?? 0,
      cacheRead: 0,
    },
  };
}

export function auraApi(): Plugin {
  return {
    name: 'aura-api',
    configureServer(server) {
      fs.mkdirSync(RUNS, { recursive: true });

      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (!url.startsWith('/api/')) return next();

        try {
          if (url === '/api/status') return send(res, 200, config());

          if (url === '/api/runs' && req.method === 'GET') {
            const files = fs
              .readdirSync(RUNS)
              .filter((f) => f.endsWith('.jsonl'))
              .map((f) => ({
                id: f.replace(/\.jsonl$/, ''),
                bytes: fs.statSync(path.join(RUNS, f)).size,
                mtime: fs.statSync(path.join(RUNS, f)).mtimeMs,
              }))
              .sort((a, b) => b.mtime - a.mtime);
            return send(res, 200, files);
          }

          if (url.startsWith('/api/runs/') && req.method === 'GET') {
            const id = path.basename(url.slice('/api/runs/'.length));
            const f = path.join(RUNS, `${id}.jsonl`);
            if (!fs.existsSync(f)) return send(res, 404, { error: 'no such run' });
            res.statusCode = 200;
            res.setHeader('content-type', 'application/x-ndjson');
            return res.end(fs.readFileSync(f, 'utf8'));
          }

          if (url === '/api/log' && req.method === 'POST') {
            const { runId, records } = JSON.parse(await readBody(req));
            if (!/^[A-Za-z0-9_-]+$/.test(runId || '')) return send(res, 400, { error: 'bad runId' });
            // append as it happens, so killing the app cannot lose the run
            fs.appendFileSync(
              path.join(RUNS, `${runId}.jsonl`),
              records.map((r: unknown) => JSON.stringify(r)).join('\n') + '\n',
            );
            return send(res, 200, { ok: true });
          }

          if (url === '/api/agent' && req.method === 'POST') {
            const c = config();
            if (!c.hasKey)
              return send(res, 503, {
                error:
                  'No API key on the server. Set ANTHROPIC_API_KEY (or AURA_ENDPOINT + AURA_API_KEY) and restart. Manual play and random-agent mode work without one.',
              });
            const body: AgentRequest = JSON.parse(await readBody(req));
            const t0 = Date.now();
            const out = c.endpoint ? await callOpenAICompatible(body) : await callAnthropic(body);
            return send(res, 200, { ...out, latencyMs: Date.now() - t0 });
          }

          return send(res, 404, { error: 'unknown endpoint' });
        } catch (err: any) {
          // surface the provider's real message; never substitute a fake reply
          return send(res, 502, { error: String(err?.message ?? err).slice(0, 1200) });
        }
      });
    },
  };
}
