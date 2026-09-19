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

## The world, in one paragraph

Four buttons, four absolute directions, nothing labelled. Two plain floors that
look different and behave identically. Solid blocks. A diagonal surface that
deflects travel 90° clockwise. And two centred, symmetrical figures drawn as a
matched pair — **concentric rings** and **radial spokes**. One ends the room. The
other kills you and sends you back to the room's start, with the action spent and
the budget still draining.

**The hidden change swaps which is which.** Neither changes appearance. An agent
carrying the old rule walks onto what it believes is the exit and dies.

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

To run a whole campaign headlessly, with no browser and no supervision:

```bash
ANTHROPIC_API_KEY=sk-... npm run campaign
```

It sends exactly the prompt and nothing else, reusing the same modules the
browser runner uses, so a headless run and a watched run are the same experiment
and produce the same replayable log. Options: `--strategy`, `--condition`,
`--budget`, `--rooms`, `--tag`.

Optional: `AURA_MODEL` (default `claude-opus-5`), `AURA_EFFORT` (`low`/`medium`/
`high`, default `medium`). For any OpenAI-compatible endpoint instead, set
`AURA_ENDPOINT` and `AURA_API_KEY`; the adapter posts to `<endpoint>/chat/completions`.

With no key the LLM driver is disabled and the UI says so. A provider error is
shown as a provider error — a failed call never becomes a fabricated agent reply.

### Check it

```bash
npm run check
```

41 checks: 14 on the engine, level set and recorded logs, and 27 on the agent
loop, the researcher/agent boundary, and the metrics.

---

## Reading what the agent is doing

Three tabs. **Play** is the room and the controls. **Replay** loads a recording.
**Behaviour** is where the agent becomes legible:

- **Belief timeline** — one row per belief, one cell per step, coloured by status,
  with derived beliefs indented under what they were built on. A row that runs
  green and turns amber at one column is the moment the agent stopped trusting
  something; the rows that stayed green beside it are the rest of the answer.
- **Prediction ledger** — what it said would happen against what did, with the
  rule change marked as a break in the list.
- **Measured** — accuracy, first telling press, first correct prediction after the
  change, first room solved after it, recovery, and missed chances.

Both work on loaded recordings too, so a committed log can be inspected without
rerunning anything.

## What counts as recovery

Fixed before any run: **three committed correct predictions in a row, after the
change**. Three rather than one, because a single correct prediction is as likely
to be luck. "First success" and "recovered" are reported separately — collapsing
them is the easiest way to overstate a result.

This is only possible because the agent commits to a `predicted_position` rather
than prose alone. A coordinate can be compared with `===`; prose can only be
judged, and judging it would score writing quality instead of understanding.
`null` means "I do not know" and is never counted as wrong.

Beliefs demoted after the change are listed but never auto-labelled right or
wrong — deciding that needs someone to read the claim, so it is left to you.

## Modes

| Mode | Needs a key | What it is for |
|---|---|---|
| Manual play | no | Play the rooms yourself; the same engine and the same log |
| Random agent | no | Integration check — exercises every path without spending anything |
| LLM agent | yes | The real thing: start, pause, single-step, restart empty |
| Replay | no | Step through a recorded run; no model calls |
| Protocols | yes | Named experiments from `src/experiment.ts`, each stating its question, what would answer it, and its cost before anything is spent |
| `npm run campaign` | yes | Runs a whole campaign headlessly and writes the same replayable log |
| `scripts/smoke.ts` | no | Drive the exact protocol by hand, for a model you cannot reach over HTTP |

Strategy, condition, budget and seed lock once a run starts — changing them
mid-run would make one log describe two experiments. Restart to change them.

---

## What the agent is and is not told

**Told:** the grid as appearance-only codes (`tile_0`, `tile_1`, `solid_tile`,
`striped_tile`, `diagonal_tile`, `concentric_tile`), entity position and a
marker showing the way it last travelled, the four button labels, the result of
its last press, how the previous room ended, its remaining budget, its memory,
and its own previous prediction echoed back.

`previous_room` matters more than it looks. It carries the press that closed the
last room, the cell it landed on, and whether the room `completed` or the agent
`ran_out_of_actions`. Without it the agent is asked to infer what ends a room
while being denied the one observation that shows it — and success and failure
both just silently become a new room.

**Never told:** what any surface does, what ends a room, which rule changed or
when, the level's name, the true rule table, or the reference solution. Every
reachable observation of every level is scanned against 23 forbidden tokens in
`npm run verify`.

In the announced-change condition it gets one sentence — *"One of the rules of
this world has changed"* — and nothing more. That condition exists to separate
the difficulty of *noticing* from the difficulty of *re-learning*.

## Controls

Four buttons, four absolute directions, no turning. The labels carry no hint;
working out which is which is the agent's first job and takes about four
presses. That is deliberate — an earlier turn-relative scheme (turn left /
forward / turn right / back) ate most of a room's budget just to pin down, and
had a redundancy that let an agent succeed while holding a wrong-but-consistent
model of turning. The budget belongs on the surface rules, because a surface
rule is what the experiment changes.

The entity's marker is cosmetic and only shows the way it last moved.

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

More importantly, every room declares the surfaces it **requires**, and
`npm run verify` bans each one and re-solves: a room claiming to teach the strip
has to be *unsolvable* without it. "Solvable" is the weak check; "solvable only
the intended way" is the one with teeth. Two rooms shipped as pure decoration
before this existed, and neither was catchable by playing — an author only ever
plays the route they already had in mind. The intervention rooms additionally
have to make the rule change cost at least 5 actions, so an agent running on a
stale rule actually pays for it.

Room 7 is the intervention: under the original rule one press crosses the room
and ends it; under the changed rule the same press advances one cell. That makes
the first press onto the strip the discriminating observation, and the log marks
every press that would look different under the other rule set.

## Logs

Written to `runs/<run_id>.jsonl` as the run happens, so killing the app cannot
lose an experiment. Each step records the observation and memory before, the
model's reply, the button, prediction, resulting observation, plus a clearly
separated `researcher` block with the true rules, the full path, and whether the
press was discriminating. Replay re-executes each recorded press through the
engine and flags any disagreement rather than hiding it.

Memory is logged as three distinct fields — `memory_in_prompt`,
`memory_proposed`, `memory_accepted` — because they are three different things
and collapsing them once made every step claim the agent had seen the memory it
had just written. The exact request is reconstructible too: `prompt_user` per
step, and the full system prompt once in `run_start`.

Runs where the rule was changed by hand are tagged `manual_intervention` so they
can never pool with automated results.

`runs/live-cold-*.jsonl` is committed and replays exactly; load it in the replay
tab and the viewer re-executes every press through the engine so you can check it
rather than take it on trust. A test asserts that this stays true for everything
in `runs/`.

Recordings from before the engine rebuild are in `runs/archive-engine-v1/` with
their own README. They are kept as evidence for `RESEARCH_LOG.md` E5/E7 but
cannot be replayed — the rooms and controls they used no longer exist. Every run
now stamps `engine_version` so this cannot go unnoticed again.

---

## Status — read this before believing any number

**No automated LLM run has ever been executed in this repository.** No API key
was available while it was built. The pilot sweep has never run.

What *has* been run: all 32 checks, manual play, the random agent, and
hand-stepped runs using a sealed subagent (Haiku 4.5, one cold spawn per action,
`tool_uses: 0` verified on every spawn).

One of those is a genuine continuous cold start — empty memory, every press
chosen by the model, nothing seeded and nothing auto-advanced. It solved room 1
in 8 actions against a reference of 4, spending the extra four identifying the
button set, and built a correct general rule with its own dependency links
along the way (`runs/live-cold-*.jsonl`). Note that step 6 of that log is
contaminated by a transcription error of mine; `RESEARCH_LOG.md` E10 says which
and why.

**No flat-memory run exists, so there is no strategy comparison yet**, and no
run has reached the intervention from self-accumulated experience. The only
adaptation evidence is still an author-seeded probe.

Three documents, by how much detail you want:
- **`REPORT.md`** — plain-language account of what was built, how the agent
  actually behaved, and what broke. Start here.
- **`RESEARCH_LOG.md`** — the dated lab notebook, entry by entry.
- **this file** — the manual.

## Known limitations

- The world is deterministic and fully observable, so a single contradiction is
  conclusive and the culprit is unambiguous. This is the biggest threat to the
  study: it may make selective revision and "just retest what broke" the same
  algorithm. Ambiguous attribution or stochastic outcomes would address it and
  neither is implemented.
- Success rate alone cannot certify that a rule was learned — an agent can reach
  a target for the wrong reason. The per-press prediction is what discriminates,
  which is why it is a required field rather than UI garnish.
- Nothing validates the agent's own `supported_by` / `depends_on` links. It can
  rewrite a claim while keeping the evidence it cited for the old one, and the
  structure will still look rigorous. Treat those fields as what the agent
  asserts, not as verified provenance.
- One rule family, one change, one direction. No A→B→A return, which is the
  cheapest way to tell real revision from fast forgetting and should be the next
  thing added.
- Per-cell n in the sweep is far too small to separate two LLM arms. Treat it as
  a smoke test of the pipeline, not a comparison.
