import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

import { ask, providerConfig } from './provider.ts';

/**
 * Dev-server middleware: the model adapter and the run log.
 *
 * There is deliberately no second process. The API key is read here, in Node,
 * and never reaches the browser, git, or an exported log: `/api/status`
 * reports which provider and model are in use and whether credentials are
 * present, never the credentials themselves. The adapters live in
 * `./provider.ts`, shared with the headless campaign runner, so a watched run
 * and a headless run reach the model through exactly the same code. When the provider
 * fails, the failure is returned as a failure — a fabricated agent reply would
 * be indistinguishable from a real one in the transcript, which is the one
 * thing an experiment log must never contain.
 */

const RUNS = path.resolve('runs');

interface AgentRequest {
  system: string;
  user: string;
  maxTokens?: number;
  /** fixed when the run was created; see the note on `ask` */
  model?: string;
}

/** Everything the browser is allowed to know about the model configuration. */
function publicConfig() {
  const c = providerConfig();
  return {
    provider: c.provider,
    model: c.model,
    endpoint: c.endpoint,
    effort: c.effort,
    hasKey: c.hasKey,
    label: c.label,
  };
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

export function auraApi(): Plugin {
  return {
    name: 'aura-api',
    configureServer(server) {
      fs.mkdirSync(RUNS, { recursive: true });

      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (!url.startsWith('/api/')) return next();

        try {
          if (url === '/api/status') return send(res, 200, publicConfig());

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
            const c = publicConfig();
            if (!c.hasKey)
              return send(res, 503, {
                error:
                  'No model credentials on the server. Set one of: OPENROUTER_API_KEY, ' +
                  'ANTHROPIC_API_KEY, AURA_ENDPOINT + AURA_API_KEY, or AURA_PROVIDER=codex. ' +
                  'Then restart. Manual play and random-agent mode work without any of them.',
              });
            const body: AgentRequest = JSON.parse(await readBody(req));
            const out = await ask(body.system, body.user, {
              maxTokens: body.maxTokens,
              model: body.model,
            });
            return send(res, 200, out);
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
