import { useState } from 'react';
import type { RunState, TranscriptEntry } from '../runner.ts';

/**
 * The wire log: exactly what was sent and exactly what came back.
 *
 * Every other view in this app is an interpretation — the belief timeline, the
 * prediction ledger, the metrics. This one interprets nothing. It is here
 * because when a run goes wrong the first question is always "what did the
 * model actually see", and answering it by opening a JSONL file in an editor is
 * slow enough that people stop asking.
 *
 * It also shows the calls that pressed no button. A malformed reply performs no
 * action by design, so those calls are invisible in the step log — and they are
 * exactly the ones that matter when a model is failing on JSON rather than on
 * reasoning. A run that looks stuck with an empty ledger is usually twenty
 * rejected replies in a row, and nothing else in the UI would tell you.
 */

function bytes(n: number) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`;
}

function Block({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone?: 'in' | 'out';
}) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className={`wblock ${tone ?? ''}`}>
      <button className="wtoggle" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} {label} <span className="dim">{bytes(text.length)}</span>
      </button>
      {open && <pre className="wpre">{text}</pre>}
    </div>
  );
}

function Row({ e }: { e: TranscriptEntry }) {
  const [open, setOpen] = useState(false);
  const mark = e.status === 'accepted' ? '✓' : e.status === 'rejected' ? '✗' : '!';
  return (
    <div className={`wrow ${e.status}`}>
      <button className="whead" onClick={() => setOpen((v) => !v)}>
        <span className="dim">#{e.n}</span>
        <span className="dim">step {e.step}</span>
        <span className="dim">room {e.level}</span>
        <span className="btn">{e.button ?? '—'}</span>
        <span className="wmark">{mark}</span>
        <span className="dim">
          {e.usage.input}/{e.usage.output} tok · {(e.latencyMs / 1000).toFixed(1)}s
          {e.toolUses !== undefined ? ` · ${e.toolUses} tool calls` : ''}
        </span>
        <span className="werr">{e.error ?? ''}</span>
      </button>
      {open && (
        <div className="wbody">
          <div className="legend">
            {e.at} · model <b>{e.model || 'unknown'}</b> · stop{' '}
            <b>{e.stopReason ?? '—'}</b>
            {e.scaffoldTokens !== undefined && (
              <>
                {' '}
                · <b>{e.scaffoldTokens}</b> tokens of agent scaffolding ahead of this prompt
              </>
            )}
          </div>
          {e.toolUses ? (
            <p className="wseal">
              SEAL BROKEN — a sealed subject made {e.toolUses} tool call(s). This call is not an
              observation about reasoning from the prompt.
            </p>
          ) : null}
          <Block label="prompt sent (user half)" text={e.user} tone="in" />
          <Block label="raw reply" text={e.raw} tone="out" />
        </div>
      )}
    </div>
  );
}

export function WirePanel({ s }: { s: RunState }) {
  const [filter, setFilter] = useState<'all' | 'rejected'>('all');
  const rows = filter === 'all' ? s.transcript : s.transcript.filter((e) => e.status !== 'accepted');

  const totals = s.transcript.reduce(
    (a, e) => ({
      input: a.input + e.usage.input,
      output: a.output + e.usage.output,
      rejected: a.rejected + (e.status === 'rejected' ? 1 : 0),
      errors: a.errors + (e.status === 'error' ? 1 : 0),
      tools: a.tools + (e.toolUses ?? 0),
    }),
    { input: 0, output: 0, rejected: 0, errors: 0, tools: 0 },
  );

  return (
    <div className="panel">
      <h2>Wire log — what was sent, what came back</h2>

      <Block label="system prompt (identical for every call in this run)" text={s.systemPrompt} tone="in" />

      {!s.transcript.length ? (
        <p style={{ color: 'var(--dim)', margin: '10px 0 0' }}>
          No model calls yet. Manual play and the random agent never call a model, so this stays
          empty for them.
        </p>
      ) : (
        <>
          <p className="legend" style={{ marginTop: 10 }}>
            {s.transcript.length} calls · {totals.input} in / {totals.output} out tokens ·{' '}
            <b style={{ color: totals.rejected ? 'var(--gold)' : undefined }}>
              {totals.rejected} rejected
            </b>{' '}
            ·{' '}
            <b style={{ color: totals.errors ? 'var(--rose)' : undefined }}>
              {totals.errors} provider errors
            </b>
            {totals.tools > 0 && (
              <b style={{ color: 'var(--rose)' }}> · {totals.tools} TOOL CALLS — seal broken</b>
            )}
          </p>
          <div className="wfilter">
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
              all
            </button>
            <button
              className={filter === 'rejected' ? 'on' : ''}
              onClick={() => setFilter('rejected')}
            >
              only the ones that pressed nothing
            </button>
          </div>
          <div className="wlist">
            {[...rows].reverse().map((e) => (
              <Row key={e.n} e={e} />
            ))}
          </div>
          <p className="legend">
            ✓ reply parsed and a button was pressed · ✗ reply could not be used, so nothing moved ·
            ! the provider itself failed. Rejected calls still cost tokens and still appear in
            `runs/*.jsonl` as `invalid_reply` records.
          </p>
        </>
      )}
    </div>
  );
}
