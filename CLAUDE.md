# AURA Rooms — working notes for Claude

A research instrument, not a product. An LLM agent is dropped into eleven grid
rooms with nothing labelled; it predicts, presses a button, rewrites its memory.
After room 6 one rule silently swaps; after room 9 it silently swaps back. The
question is whether it acquires a world model, detects the change, revises the
right belief — and whether the second revision is cheaper than the first.

Read in this order: `README.md` (manual), `REPORT.md` (story), `RESEARCH_LOG.md`
(lab notebook, volume 2: the instrument as it stands, standing results, entries
from E21) and `RESEARCH_LOG_E0-E20.md` (volume 1, the history). Most "why is it
like this" questions are answered there, usually with the bug that motivated it.

## Commands

```bash
npm run dev          # vite + API middleware on http://localhost:5178 (launch.json name: "aura")
npm run check        # typecheck BOTH tsconfigs + 75 checks (verify.ts + harness.test.ts)
npm run campaign -- --strategy=structured --condition=hidden --budget=25 --tag=name
```

`.env` holds credentials (gitignored; currently an OpenRouter key). Provider is
chosen from the environment only — `AURA_PROVIDER=codex AURA_MODEL=gpt-5.6-luna`
for a codex run — never from the UI. Always run `npm run check` before committing;
it takes ~10 s and it is the only thing standing between a room edit and a
curriculum that quietly teaches nothing.

## Layout

| path | what |
|---|---|
| `src/engine/` | deterministic world: `types.ts` (glyphs, `ENGINE_VERSION`), `engine.ts` (`step`, rules), `levels.ts` (the 11 rooms, `INTERVENTIONS_BEFORE_LEVELS` — **the curriculum is the experiment**), `observation.ts` (what the agent is shown + `auditForLeaks`), `solver.ts` (BFS, `banned` option) |
| `src/agent/` | `prompt.ts` (system/user prompt), `schema.ts` (reply validation, 4 prediction fields), `memory.ts` (flat / structured stores, and `native` = no store, codex keeps its own conversation) |
| `src/metrics.ts` | `resolveBoth` (every press resolved under both rule sets → `divergent_fields`), `computeMetrics` (R1 ∧ R2 recovery, strict R1, delays, stale-rule counts, `collateralDrop`; scored per scheduled change in `changes[]`, top-level = the first) |
| `src/runner.ts`, `src/experiment.ts` | browser run loop; declared protocols |
| `src/ui/`, `src/App.tsx` | Play / Replay / Behaviour / Wire log tabs |
| `server/provider.ts` | the ONLY model adapter: anthropic / openai-compatible / codex. `server/api.ts` is vite middleware over it |
| `scripts/campaign.ts` | headless runner; imports the same modules the browser uses |
| `scripts/verify.ts`, `scripts/harness.test.ts` | the 75 checks (`node --test`) |
| `scripts/smoke.ts` | hand-driven stepper for a model with no HTTP endpoint |
| `runs/` | JSONL run logs + `archive-engine-v1..3/` (unreplayable, each with a README) |

Node runs the `.ts` files directly via type-stripping: keep everything
**erasable-only** (no enums, no namespaces, no parameter properties), and import
with explicit `.ts` extensions.

## Non-negotiables

- **Never tune the harness to make the subject look better.** The observation may
  carry only what a person watching the screen could see (`before`, `after`,
  `came_from`, `room_changed`, `previous_room.outcome`), never a cause. The reply
  schema names no events. The word `rule` must not reach a hidden-arm agent.
  `auditForLeaks` runs on every observation against 48 word-start tokens; a new
  field or prompt sentence needs a test, not a promise.
- **A subject failure is a finding, not a bug.** If the agent misreads
  `came_from`, that goes in the research log, not in a prompt tweak. Harness bugs
  are things that *withhold* an observation a person would have had (E7, E9, E13).
- **The codex subject is sealed** (`--sandbox read-only`, empty temp `-C`,
  `--ignore-user-config --ignore-rules --ephemeral`, prompt over stdin). The
  `native` arm drops `--ephemeral` only: one persisted session per run, resumed
  by id, sandbox and root inherited (checked). Any
  `seal_alarm` whose item is a command/file/search makes the run non-evidence.
  Planning/todo items are noise — do not report them as a broken seal.
- **Run logs are data.** Never edit a recorded `.jsonl`; correct the prose that
  cites it. `runs/*.jsonl` is gitignored; a log that `RESEARCH_LOG.md` cites gets
  an explicit `!runs/<file>` un-ignore line (the file is the evidence). Every
  `.jsonl` left in `runs/` must replay exactly (`verify.ts` checks all of them),
  so when `ENGINE_VERSION` bumps, move old logs to `runs/archive-engine-vN/` with a
  README saying what they were and why they cannot replay.
- **Do not pool a codex arm with an API arm** without saying so: codex has no
  system/user split and ~11k tokens of its own scaffolding. `scaffold_tokens` and
  `tool_uses` are recorded per call for this reason.
- Strategy / condition / budget / model lock when a run starts. A log describes
  one experiment.

## Conventions

- `RESEARCH_LOG.md` (volume 2, from E21; volume 1 is `RESEARCH_LOG_E0-E20.md`)
  is append-only, newest at the bottom, entries numbered `E<n>` with the date. Tag every claim `[measured]`, `[derived]` or
  `[assumption]`. Record what did not work. Corrections to earlier entries are
  added as a dated note under the old entry, never by rewriting history.
- Editing a room: keep `requires` honest; `npm run verify` bans each required
  surface and asserts unsolvability, checks no two rooms share a solution, rooms
  1–2 hazard-free, rooms 7 and 10 contradictory both ways, rooms 7–11 solvable
  under both regimes, the deflector carrying in rooms 5 and 11. Then update the
  reference-length table in README.
- Changing what the agent sees or predicts → update the forbidden-token list,
  the schema test, and `PREDICTION_FIELDS`; bump `ENGINE_VERSION` if old logs
  stop replaying.
- Commit messages explain the *why* in the body; the repo's history is part of
  the lab notebook.
- Windows: `codex` is a `.cmd` shim so Node needs `shell: true` (hence DEP0190);
  set `AURA_CODEX_BIN` to `.../@openai/codex/bin/codex.js` to avoid it. Paths in
  Bash are `/c/p2/autoaura/...`.

## Where things stand (2026-09-19, branch `aura-v4`)

Engine v5, eleven rooms, two swaps, three memory arms. The finding that ends
volume 1 (E20): on the same subject (codex · gpt-5.6-luna) the structured
store never attributes a return-to-start to the tile in three runs, while the
subject's own conversation (`native`) does so after one death and finishes
11/11 with both changes recovered. Five logs are committed as evidence (see
`.gitignore`). Next, in order: flat arm on codex; structured arm with a
neutral example id; stable and notified arms; an API subject; recording
codex's reasoning items. No flat-memory run exists on any engine.
