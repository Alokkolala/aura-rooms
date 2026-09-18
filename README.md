# AURA Rooms

A testbed for one question: **how does the way an agent organises its memory
affect its ability to recover when a rule it had already learned is quietly
changed underneath it?**

An LLM agent is dropped into a grid room. It is told nothing about what the four
buttons do, what the surfaces do, or what ends a room. It presses a button,
states what it expects to see, sees what actually happened, and edits its memory.
Memory is the only thing that survives between rooms. After room six, one rule
changes with no announcement.

Everything the agent sees, thinks and writes is on screen next to the room, and
a separate researcher panel shows the true rules the agent cannot see.

---

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5178. Manual play, the random agent, and replay all work
with no API key.

### Connect a model

The key is read server-side and never reaches the browser, git, or an exported
log.

```bash
ANTHROPIC_API_KEY=sk-... npm run dev
```

Optional: `AURA_MODEL` (default `claude-opus-5`), `AURA_EFFORT` (`low`/`medium`/
`high`, default `medium`). For any OpenAI-compatible endpoint instead, set
`AURA_ENDPOINT` and `AURA_API_KEY`; the adapter posts to `<endpoint>/chat/completions`.

With no key the LLM driver is disabled and the UI says so. A provider error is
shown as a provider error — a failed call never becomes a fabricated agent reply.

### Check it

```bash
npm run check
```

27 checks: 10 on the engine and level set, 17 on the agent loop and the
researcher/agent boundary.

---

## Modes

| Mode | Needs a key | What it is for |
|---|---|---|
| Manual play | no | Play the rooms yourself; the same engine and the same log |
| Random agent | no | Integration check — exercises every path without spending anything |
| LLM agent | yes | The real thing: start, pause, single-step, restart empty |
| Replay | no | Step through a recorded run; no model calls |
| Pilot sweep | yes | Both strategies × three conditions, gated behind a confirm |
| `scripts/smoke.ts` | no | Drive the exact protocol by hand, for a model you cannot reach over HTTP |

Strategy, condition, budget and seed lock once a run starts — changing them
mid-run would make one log describe two experiments. Restart to change them.

---

## What the agent is and is not told

**Told:** the grid as appearance-only codes (`tile_0`, `tile_1`, `solid_tile`,
`striped_tile`, `diagonal_tile`, `concentric_tile`), entity position and a
facing marker, the four button labels, the result of its last press, its
remaining budget, its memory, and its own previous prediction echoed back.

**Never told:** what any surface does, what ends a room, which rule changed or
when, the level's name, the true rule table, or the reference solution. Every
reachable observation of every level is scanned against 23 forbidden tokens in
`npm run verify`.

In the announced-change condition it gets one sentence — *"One of the rules of
this world has changed"* — and nothing more. That condition exists to separate
the difficulty of *noticing* from the difficulty of *re-learning*.

## Memory strategies

Both arms get the same model, observations, budget, response schema, character
limit, and the same explicit permission to correct anything they previously
wrote. The flat arm is not a strawman.

- **flat** — one free-text block, replaced in full each turn.
- **structured** — a list of entries with `id`, `claim`, `conditions`, `status`
  (hypothesis / confirmed / suspect / superseded), `supported_by`,
  `contradicted_by`, `depends_on`. The agent decides what depends on what;
  nothing validates the links for it.

Each request is rebuilt from scratch out of (fixed instruction + observation +
memory). No chat history, no server session. What an arm knows is exactly what
its store holds — otherwise the experiment would be measuring the context window.

## The rooms

Eight hand-authored maps, each verified solvable by breadth-first search over
engine states. Rooms 7 and 8 are verified solvable under **both** rule sets and
are geometrically identical across all three conditions, so only the rule
differs.

Room 7 is the intervention: under the original rule one press crosses the room
and ends it; under the changed rule the same press advances one cell. That makes
the first press onto the strip the discriminating observation, and the log marks
every press that would look different under the other rule set.

## Logs

Written to `runs/<run_id>.jsonl` as the run happens, so killing the app cannot
lose an experiment. Each step records the observation and memory before, the
model's reply, the button, prediction, resulting observation and memory, plus a
clearly separated `researcher` block with the true rules, the full path, and
whether the press was discriminating. Replay re-executes each recorded press
through the engine and flags any disagreement rather than hiding it.

Runs where the rule was changed by hand are tagged `manual_intervention` so they
can never pool with automated results.

Three probe runs are committed in `runs/` because `RESEARCH_LOG.md` makes claims
about them. Open the replay tab and load them: `smoke-cold-*` is the cold start,
`probe3-*` is the revision failure, `probe4-echofix-*` is the same step after the
prompt fix. The replay re-executes every recorded press through the engine, so
you can check the logs rather than take them on trust.

---

## Status — read this before believing any number

**No automated LLM run has ever been executed in this repository.** No API key
was available while it was built. The pilot sweep has never run.

What *has* been run: all 27 checks, manual play, the random agent, and a set of
hand-stepped probes using a sealed subagent (Haiku 4.5, one cold spawn per
action, `tool_uses: 0` verified on every spawn). Those probes are prompt smoke
tests, n=1, with author-seeded memory in one case. They are evidence about the
instrument, not about the world.

`RESEARCH_LOG.md` is the lab notebook: what was run, what was found, what broke,
and three fairness bugs the probes exposed in the instrument itself.

## Known limitations

- The world is deterministic and fully observable, so a single contradiction is
  conclusive and the culprit is unambiguous. This is the biggest threat to the
  study: it may make selective revision and "just retest what broke" the same
  algorithm. Ambiguous attribution or stochastic outcomes would address it and
  neither is implemented.
- `A` then `D` and `C` then `B` produce identical displacement, so an agent can
  succeed while holding a self-consistent but wrong model of the turn buttons.
  Success rate alone cannot certify that a rule was learned; the per-press
  prediction is what discriminates.
- One rule family, one change, one direction. No A→B→A return, which is the
  cheapest way to tell real revision from fast forgetting and should be the next
  thing added.
- Per-cell n in the sweep is far too small to separate two LLM arms. Treat it as
  a smoke test of the pipeline, not a comparison.
