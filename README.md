# AURA Rooms

A testbed for one question:

> **Can an autonomous agent discover the rules of an unknown world, use them
> across levels, detect when a previously reliable rule silently changes, and
> revise its world model efficiently?**

An LLM agent is dropped into a grid room. Nothing is labelled and nothing is
explained. It presses a button, commits in advance to what it expects to see,
sees what actually happened, and rewrites its memory. Memory is the only thing
that survives between rooms. Eight rooms teach one thing each — controls, then
what ends a room, then the hazard, then transfer, then the deflector, then all
of it together. After room six, one rule changes with no announcement, and the
last two rooms measure what the agent does about it.

Everything the agent sees, thinks and writes is on screen next to the room, and
a separate researcher panel shows the true rules the agent cannot see.

**Flat vs structured memory is a sub-experiment here, not the definition of the
project.** It asks which way of *storing* beliefs revises better. It says
nothing about whether the beliefs can be acquired in the first place, which is
what rooms 1–6 are for.

---

## The world, in one paragraph

Four buttons, four absolute directions, nothing labelled. Two plain floors that
look different and behave identically. Solid blocks. A diagonal surface that
deflects travel 90° clockwise and carries the entity one more cell. And two
centred, symmetrical figures drawn as a matched pair — **concentric rings** and
**radial spokes**. One ends the room. The other sends the entity back to where
the room started, with the action spent and the budget still draining.

**The hidden change swaps which is which.** Neither changes appearance. An agent
carrying the old rule walks onto what it believes is the way out and loses the
room.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5178. Manual play, the random agent, and replay all work
with no API key.

### Connect a model

Credentials are read server-side and never reach the browser, git, or an
exported log. `/api/status` reports which provider and model are in use and
whether credentials are present — never the credentials themselves.

Put them in a `.env` file at the repo root (already gitignored), or set them in
the environment; the environment wins if both are present.

```
# .env  -- pick ONE of these blocks

OPENROUTER_API_KEY=sk-or-...
AURA_MODEL=anthropic/claude-sonnet-5

# or Anthropic direct
ANTHROPIC_API_KEY=sk-ant-...
AURA_MODEL=claude-opus-5

# or any OpenAI-compatible server (Ollama, LM Studio, vLLM, a proxy)
AURA_ENDPOINT=http://localhost:11434/v1
AURA_API_KEY=whatever
AURA_MODEL=llama3.1

# or the codex CLI, driven as a sealed subprocess
AURA_PROVIDER=codex
AURA_MODEL=gpt-5.6-luna
```

`OPENROUTER_API_KEY` alone is enough — the endpoint is implied. Then:

```bash
npm run dev
```

Open http://localhost:5178 and land on **Agent console** — one page with the
model box, the controls, the room, the live counters and the full wire log side
by side. Paste any OpenRouter slug into **Model** (it overrides `AURA_MODEL` for
that run), pick strategy / condition / budget, then Start, Pause or One step.

Everything on that page locks the moment the run takes its first action, and the
model you typed is written into `run_start` alongside strategy and condition —
the subject is part of what defines the experiment, not a dial. To change it,
Restart.

The counters to watch are **calls** against **pressed nothing**. If the second
climbs with the first, the model is failing on the JSON rather than on the
rooms, and the console says so in as many words. Open a ✗ row and read what it
actually sent.

To run headlessly instead:

```bash
npm run campaign -- --strategy=structured --condition=hidden --budget=25
```

Both routes go through the same `server/provider.ts`, so a watched run and a
headless run reach the model through identical code.

A run that stops on a provider error can be continued exactly — nothing carries
between presses except the memory store and the last observation, and the log
records both:

```bash
npm run campaign -- --resume=runs/<id>.jsonl --retries=2
```

Strategy, condition, budget, provider, model and system prompt are taken from or
checked against the log, so the seam cannot splice two experiments; a
`run_resume` record marks it. A test hydrates every prefix of every log in
`runs/` and asserts the prompt it would send is byte-for-byte the one the next
recorded step received. `AURA_TIMEOUT_MS` caps a single call (default 300 s),
and a press is asked again after a provider error, every attempt logged.

### The three subjects are not equivalent

| provider | how it is called | caveat |
|---|---|---|
| `anthropic` | Messages API, system + user | the reference path |
| `openai-compatible` | `chat/completions`, system + user | OpenRouter answers **200 with an error body** when a model is unavailable or moderated; that is raised as an error rather than recorded as the agent having said nothing |
| `codex` | `codex exec` subprocess | **no system/user split** — the halves are concatenated — and the subject arrives wrapped in ~11,600 tokens of codex's own agent scaffolding before it sees the prompt |

Do not pool a codex arm with an API arm without saying so. Every codex reply
records `scaffold_tokens` and `tool_uses` so the difference is visible in the
log rather than implied.

**The codex subject is sealed**, and the seal is a test (`THE CODEX SUBJECT IS
SEALED`), not a comment:

- `--sandbox read-only` — no writes, no network
- `-C <fresh empty temp dir>` — never this repository. An agent that can open
  `src/engine/levels.ts` can look up which surface ends a room, which does not
  make the experiment hard, it makes it theatre
- `--ignore-user-config` — `~/.codex/config.toml` is not loaded, so the
  operator's own instructions and skills cannot become an uncontrolled variable
  inside the subject
- `--ignore-rules`, `--ephemeral` — no execpolicy rules, and no session file, so
  one press cannot see the last. Every press is answered from the prompt and the
  memory store alone, exactly as on the API arms
- `--json` — every reply counts the items codex produced besides the message.
  **A non-zero count is a finding, not a detail**: it is written to the log as
  `seal_alarm` with the item types, shown in red in the UI, and counted in the
  summary. A command, file, search or fetch item is `leaky` and the run is
  flagged `SEAL BROKEN`; a planning or `error` item is recorded and reported as
  "seal intact", because it cannot have read the world

The prompt goes to codex over **stdin**, not as an argument. On Windows `codex`
is a `.cmd` shim that Node will only launch with `shell: true`, and Node then
concatenates argv without escaping — a multi-kilobyte prompt full of quotes and
braces would be mangled. Set `AURA_CODEX_BIN` to the package's own
`bin/codex.js` to skip the shell entirely.

### Check it

```bash
npm run check
```

Typechecks both projects and runs **77 checks**: 22 on the engine, curriculum and
recorded logs, and 55 on the agent loop, the researcher/agent boundary, the
metrics, the provider layer, and resuming. `scripts/` and `server/` are typechecked too — they were not, and a
function nested inside another one meant the hand-driven stepper silently never
applied the rule change at all.

---

## The curriculum

Eleven hand-authored rooms. Each introduces exactly one thing, and the order is
the experiment: if two mechanics arrive together there is no way to tell
afterwards which one the agent was learning. The surfaces swap before room 7
and swap **back** before room 10, so the last two rooms are played under the
original rules again — the A→B→A return that asks whether the first revision
was an idea or an overwrite.

| # | room | size | requires | original rules | swapped rules |
|---|---|---|---|---|---|
| 1 | controls | 5×5 | — | 4 `AABB` | — |
| 2 | the same shape | 7×4 | — | 4 `AADD` | — |
| 3 | the straight line | 5×5 | — | 6 `ABAADA` | — |
| 4 | two doors | 7×5 | — | 5 `BBAAA` | — |
| 5 | reorientation | 7×5 | `/` | 9 `DDDDAAABB` | — |
| 6 | assembly | 9×5 | `/` | 19 `DAAADADDDDDCCCCBBAA` | — |
| — | *the swap happens here, silently* | | | | |
| 7 | the same two | 9×5 | — | 11 `DDDAAABBBBB` | **4 `BBBA`** |
| 8 | transfer | 9×6 | `/` | 11 `ADDDDDAAABA` | **10 `ADDDDDAAAA`** |
| 9 | in the way | 7×7 | — | 2 `AA` | **8 `BBAAAADD`** |
| — | *the swap is undone here, just as silently* | | | | |
| 10 | the return | 9×7 | — | **7 `DDDAABB`** | 13 `BBBAAAADDDDDD` |
| 11 | transfer II | 9×6 | `/` | **8 `CCCDDDDD`** | 3 `CCD` |

Reference lengths are exact shortest paths from breadth-first search over engine
states, printed by `npm run verify`. Bold marks the regime a changed arm
actually plays the room under; the stable arm plays every room under the
original rules.

1. **controls** — what the buttons do. **No lethal surface exists in this room**,
   so all four can be separated without any of them costing a life. The rings are
   offset from the start, so no single button repeated wins: finishing requires
   having told at least two of them apart.
2. **the same shape** — which surface ends a room. Still no lethal surface. Room
   1's rings stood at (3,2); here (3,2) is ordinary floor directly beneath the
   rings, reachable on a route exactly as short as the one around it, so the
   agent can stand on last room's winning square and watch nothing happen. The
   start is mirrored because with it on the left both rooms were finished by the
   identical sequence `AABB` — which would have taught *replay*, not belief. A
   test now fails if any two rooms share a solution.
3. **the straight line** — the lethal surface, introduced where it cannot be
   missed. The rings sit straight above the start and the radial sits exactly
   halfway, so "press the same button until something happens" walks onto it on
   the second press. Going round costs six.
4. **two doors** — transfer, as a forced choice. Two identical corridors, one
   surface at the end of each, exactly the same distance away. Every solution
   commits to a belief about which is which, so this room yields a measurement
   whatever the agent does. A room where the hazard can simply be ignored
   measures nothing when it is ignored.
5. **reorientation** — the deflector, and being deflected is the only way into
   the pocket holding the rings. A radial sits in plain view on the way.
6. **assembly** — all three mechanics at once, nothing new.
7. **the same two** — the intervention room, entered with the surfaces already
   swapped and nothing said. Under the original rules the short climb up the
   right-hand column ends on the lethal surface and the rings must be reached the
   long way round. After the swap those two facts trade places *exactly*: the
   long route the agent spent six rooms learning to prefer now kills it, and the
   short one it learned to fear is the answer — four presses from the start, so
   what this measures is recovery and not luck. A test asserts all of that:
   replaying the pre-change solution under the new rules must be fatal, and the
   post-change solution must be fatal under the old ones.
8. **transfer** — new geometry, both surfaces behind a deflector and sitting side
   by side. The revised rule has to be combined with the deflector rule that
   never changed, and an agent that has half-revised walks one cell too far.
9. **in the way** — the revised rule as a *plan*, not a goal. After room 7 the
   radial is the only other marked surface, so heading for it is consistent
   with "the rings are not the goal" and says nothing about whether the agent
   knows the rings now send it back. Here the rings sit on the direct climb to
   the radial, two presses up, and the only safe way is the loop round either
   side: eight presses. An agent that holds the rings as a hazard takes the
   loop first time; one that only re-aimed walks into them and learns it the
   expensive way. (Rooms 3 and 4 could not separate "sent to the start" from
   "dropped to the bottom of the column" — a gravity story one subject actually
   held for three deaths; room 5 was the first that could.)
10. **the return** — the second intervention: the surfaces trade *back*,
    silently, and the agent arrives holding the rule it revised to. Room 7's
    logic with a different map and button string: the surface it now wants is
    at the end of the long way round and kills; the one it learned to avoid is
    seven presses up a dead-end branch and wins. What is measured is the delay
    of the second revision against the first — an agent that formed the idea
    "those two can trade places" should pay less the second time; one that
    merely overwrote a goal pays the full price again. The same replay
    assertions hold for this room as for room 7.
11. **transfer II** — the re-revised rule in a new map, and the deflector in an
    orientation it has not been seen in: room 5 turned an upward climb to the
    right, this one turns a descent to the left, into the corridor holding the
    rings, and there is no other way in. The radial sits one press off the
    column on the way down — three presses for an agent still carrying the
    rule from rooms 7–9, eight for one that has let it go.

Rooms 1–6 are only ever played under the original rules, which is what frees 1
and 2 to contain no lethal surface at all. Every room from 7 on is verified
solvable under **both** rule sets, because the `stable` control arm reaches
them unswapped, and all are geometrically identical across the conditions.
Rooms 10 and 11 are played under the original rules by *every* arm, so
anything the changed arms do differently there is what they carried out of
rooms 7–9, not the room.

Every room declares the surfaces it **requires**, and `npm run verify` bans each
one and re-solves: a room claiming to teach the deflector has to be *unsolvable*
without it. "Solvable" is the weak check; "solvable only the intended way" is the
one with teeth. Three rooms shipped as pure decoration before this existed, and
none was catchable by playing — an author only ever plays the route they already
had in mind.

## What the agent predicts

Before each press the agent commits to four independent, falsifiable claims
about what a person would see:

| field | meaning |
|---|---|
| `end_position` | the square it will be standing on once everything has settled |
| `position_changed` | whether it will be standing anywhere other than now |
| `returned_to_start` | whether it will be standing on the square this room began on |
| `room_changed` | whether the next turn will be in a different room |

Any field may be `null`, which records "I am not saying" and is **never** scored
as wrong. Each is compared with `===` against what the engine actually did, so
"was the agent right" is arithmetic, not an opinion, and no LLM judge is
involved anywhere.

**None of these names a cause.** The obvious design is a single event enum —
*move / blocked / deflected / death / room_complete* — and it is wrong twice
over. It leaks: putting that vocabulary in the schema tells a room-1 agent, on
turn one, that dying and being thrown across the room are things this world does,
before rooms 3 and 5 introduce them. And it forces an arbitrary precedence when a
press does two things at once, so the agent would be scored partly on guessing a
labelling convention. `returned_to_start` is what being sent back *looks like*;
`room_changed` is what finishing *looks like*. The agent can write its causal
interpretation in free text, which nothing scores.

## What counts as recovery

Fixed before any run. An agent has recovered when **both** of these have happened
after the change:

- **R1** — a **correct prediction about something the change actually altered**:
  a press whose observable outcome differs between the two rule sets, called
  correctly on one of the fields where they differ.
- **R2** — **a room finished after the change**.

`recoveredAtStep` is whichever landed last.

The engine resolves every press *twice* — under the rules in force and under the
other set — and records `divergent_fields`, the fields where those two disagree.
That is what makes R1 meaningful, and it is why **three correct predictions of
ordinary movement can no longer count as recovery**. Under the old criterion they
did: three presses down an empty corridor look identical before and after the
swap, and an agent that had revised nothing scored a recovery for being able to
count squares. A test called `ORDINARY MOVEMENT ACCURACY CANNOT TRIGGER RECOVERY`
feeds ten consecutive correct ordinary predictions plus a finished room and
asserts `recovered === false`.

R2 is there because a prediction is cheap and a room is not: an agent can be
right about a surface and never act on it.

**Transfer to room 8 is reported beside recovery, not folded into it.** It is a
strictly harder bar; folding it in would make `recovered` false for nearly every
run in every arm, and a number that is always zero separates nothing.

### What is tracked

| metric | what it is |
|---|---|
| `predictionViolations` | presses where the world contradicted a committed field |
| `firstEvidenceStep` | the first press after the change that *could* have revealed it |
| `detectionDelay` | R1 minus `firstEvidenceStep` — presses spent with the evidence already in hand |
| `detectionDelayFromChange` | R1 minus the intervention, which the agent cannot see |
| `flaggedAtStep` | first self-reported contradiction at or after the first evidence |
| `ruleRelevantViolations` | committed predictions on altered fields that were wrong |
| `staleRulePredictions` | …of those, the ones that were exactly what the dead rule predicted |
| `staleRuleActions` / `staleRuleDeaths` | presses onto the surface that used to end rooms, and the ones that cost the room |
| `postChangeCompletionStep` | R2 |
| `recovered` / `recoveredAtStep` | R1 ∧ R2 |
| `transferStep` / `transferSucceeded` | room 8 finished after the change |
| `collateralDrop` | accuracy on fields the change did **not** alter, before minus after |
| `demotedAfterChange` | beliefs confirmed before the change and demoted after it |
| `hazardContacts` | per room, presses that put the entity on the lethal surface |

Detection delay is measured from the first *evidence*, not from the change.
Measuring from the intervention punishes an agent for time it had no way to use:
until a press actually diverges there is nothing on screen to notice. Both are
reported.

`collateralDrop` is the only collateral measure that works for both memory
formats — a flat store has no statuses to demote, so belief bookkeeping cannot
compare the arms. `demotedAfterChange` is still reported for structured runs, and
never auto-labelled right or wrong: deciding that needs someone to read the
claim, so it is left to you.

## Reading what the agent is doing

Three tabs. **Play** is the room and the controls. **Replay** loads a recording.
**Behaviour** is where the agent becomes legible:

- **Belief timeline** — one row per belief, one cell per step, coloured by status,
  with derived beliefs indented under what they were built on. A row that runs
  green and turns amber at one column is the moment the agent stopped trusting
  something; the rows that stayed green beside it are the rest of the answer.
- **Prediction ledger** — the four claims against what happened, with `⌁` marking
  every press that would look different under the other rule set, and the change
  itself marked as a break in the list.
- **Measured** — everything in the table above.

Those work on loaded recordings, so a committed log can be inspected
without rerunning anything.

**Wire log** is the fourth tab, and it interprets nothing: the system prompt
once, then every model call with the exact prompt sent and the exact text that
came back, plus model, latency, tokens and stop reason. It also shows the calls
that **pressed no button** — a malformed reply performs no action by design, so
those calls are invisible in the step log, and they are exactly the ones you
need when a model is failing on JSON rather than on reasoning. A run that looks
stuck with an empty ledger is usually twenty rejected replies in a row, and
nothing else in the UI would tell you. Codex calls additionally show their
scaffolding size and tool-call count.

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

## Protocols

`src/experiment.ts` declares each experiment in advance: the arms, the repeats,
the question in one sentence, and what result would count as an answer. If the
question is not written down before the run it is far too easy to discover
afterwards that the run answered a different one.

- **`acquisition-and-revision`** — the main protocol. Structured memory across
  `stable` / `hidden` / `notified`. The stable arm is the control: it plays the
  same eleven rooms with nothing swapped, so any drop after room 6 that appears
  there too is the rooms, not the change. Every scheduled change is scored on
  its own (`metrics.changes[k]`): evidence step, R1, R2, recovery, transfer and
  stale-rule counts for the swap before room 7 and again for the swap back
  before room 10.
- **`detection-vs-relearning`** — hidden against announced. A small gap means
  noticing was never the bottleneck and the cost is in re-learning.
- **`memory-comparison`** — the sub-experiment. Flat against structured, holding
  the world constant.
- **`smoke`** — one arm, measures nothing, proves the loop runs.

---

## What the agent is and is not told

**Told:** the grid as appearance-only codes (`tile_0`, `tile_1`, `solid_tile`,
`diagonal_tile`, `concentric_tile`, `radial_tile`), entity position and a marker
showing the way it last travelled, the four button labels, the result of its last
press, how the previous room ended, its remaining budget, its memory, and its own
previous commitment echoed back.

The record of a press is `{button, before, after, came_from, room_changed}`.
`came_from` is the last cell it occupied before coming to rest — always present,
no special case. On an ordinary move that is the cell it stepped out of; when
something threw it across the room, that is the cell it was standing on when it
happened. Without it the experiment is unwinnable: an agent once concluded it had
been punished for *returning to the starting position*, because `before` and
`after` alone said only "I was here, now I am there". A person watching would
have seen exactly where it last stood, so the agent is shown that too. What it is
not shown is *why*, or that a cause exists at all.

`previous_room` carries the press that closed the last room and whether the room
was `ended_by_action` or the agent's `actions_exhausted`. Without it the agent is
asked to infer what ends a room while being denied the one observation that shows
it — and success and failure both silently become a new room.

**Never told:** what any surface does, what ends a room, which rule changed or
when, the level's name, the true rule table, the reference solution, or that the
rules can change at all. Every reachable observation of every level is scanned
against **48 forbidden tokens** in `npm run verify`, and the tokens now include
event causes (`die`, `death`, `kill`, `deflect`, `complete`, `carried`, `safe`,
`trap`, `reset`, …) and not only surface functions.

The system prompt is the machinery of a turn plus one line of objective —
*"Explore the environment and progress as far as you can."* — and nothing else.
Two sentences were removed for v4:

- *"The rules of this world are usually stable, but they are not guaranteed to
  stay that way."* This sat in the block **common to every arm**, so the hidden
  arm was warned, the stable arm was warned about something that never happens,
  and the announced arm's one sentence was no longer what distinguished it. A
  test now asserts that the word *"rule"* does not appear anywhere in what a
  hidden-arm agent is sent.
- *"Be willing to spend a press on a deliberate test… a press that resolves an
  uncertainty is usually worth more than a press that acts on a guess."* That is
  the experimental strategy being handed to the subject. Whether an agent chooses
  to probe is part of what is under study.

In the announced-change condition it gets one sentence — *"One of the rules of
this world has changed"* — attached to one observation, and nothing more. A test
asserts it appears only in that arm, only once, and that *"rule"* appears nowhere
else in that prompt either.

## Controls

Four buttons, four absolute directions, no turning. The labels carry no hint;
working out which is which is the agent's first job and takes about four presses.
That is deliberate — an earlier turn-relative scheme (turn left / forward / turn
right / back) ate most of a room's budget just to pin down, and had a redundancy
that let an agent succeed while holding a wrong-but-consistent model of turning.
The budget belongs on the surface rules, because a surface rule is what the
experiment changes.

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

## Logs

Written to `runs/<run_id>.jsonl` as the run happens, so killing the app cannot
lose an experiment. Each step records the observation and memory before, the
model's reply, the button, the four committed claims, the resulting observation,
plus a clearly separated `researcher` block with the true rules, the full path,
**the outcome under both rule sets**, and the `divergent_fields` between them.
Replay re-executes each recorded press through the engine and flags any
disagreement rather than hiding it.

Memory is logged as three distinct fields — `memory_in_prompt`,
`memory_proposed`, `memory_accepted` — because they are three different things
and collapsing them once made every step claim the agent had seen the memory it
had just written. The exact request is reconstructible too: `prompt_user` per
step, and the full system prompt once in `run_start`.

Runs where the rule was changed by hand are tagged `manual_intervention` so they
can never pool with automated results.

Recordings from earlier engines are in `runs/archive-engine-v1/`, `-v2/` and
`-v3/`, each with its own README saying what it was and why it cannot be
replayed. Every run stamps `engine_version`, and a test asserts that everything
still in `runs/` replays exactly.

---

## Status — read this before believing any number

**One automated run exists on this engine**, and it is n=1, one subject, one
arm: `runs/codex-v4-2026-09-19T1208.jsonl` — `codex exec · gpt-5.6-luna`,
structured memory, hidden condition, 25 presses per room, 114 presses, sealed
throughout. It solved 7 of 8 rooms, died on the rings after the swap exactly as
room 7 is built to make it, finished rooms 7 and 8, and is scored `recovered` at
step 94 and `transferSucceeded` at 114 by the criterion above. Read
`RESEARCH_LOG.md` E17 before repeating those two words: every one of its ten
deaths was blamed on a button, the tile rule was never written down, and R1
fired on a press that was two-thirds stale. The pre-registered criterion has a
hole, the stricter replacement is written down there, and both scorings are
reported.

Nothing here is a comparison. The stable arm and the flat arm have never been
run on any engine. The codex subject carries ~11,700 tokens of its own
scaffolding per call and has no system/user split; do not pool it with an API
model.

Earlier engines were exercised only by hand-stepped runs using a sealed subagent
(Haiku 4.5, one cold spawn per action, `tool_uses: 0` verified on every spawn).
Those runs are archived and cannot be rescored: they recorded a single
`predicted_position` where a v4 step records four separate claims. The
behavioural findings in `REPORT.md` and `RESEARCH_LOG.md` E5–E15 describe **the
previous instrument** and are marked with the engine they came from.

Three documents, by how much detail you want:
- **`REPORT.md`** — plain-language account of what was built, how the agent
  actually behaved, and what broke. Start here.
- **`RESEARCH_LOG.md`** — the dated lab notebook, entry by entry.
- **this file** — the manual.

## Known limitations

- **n=1.** One run, one subject, one arm. Every behavioural claim about v4 is
  a description of a single trajectory.
- **Rooms 6 and 8 do not demonstrate the deflector.** On both reference
  solutions the diagonal is entered heading into a wall, so it never carries the
  entity; `requires: ['/']` holds only because the cell is on the only path. The
  claims in the curriculum table that room 6 exercises all three mechanics and
  that room 8 combines the revised rule with the deflector rule are false of the
  shipped geometry. Fixing them changes the rooms, which archives the one v4 log.
  See E17.
- **R1 as pre-registered can fire on a partially stale press.** It accepts any
  one correctly called divergent field; E17 shows a press that was wrong in
  exactly the dead rule's way on two fields and right on the third, and it
  scored as revised. The next run pre-registers "every committed divergent field
  correct".
- The world is deterministic and fully observable, so a single contradiction is
  conclusive and the culprit is unambiguous. This is the biggest threat to the
  study: it may make selective revision and "just retest what broke" the same
  algorithm. Ambiguous attribution or stochastic outcomes would address it and
  neither is implemented.
- R1 requires the agent to *commit*. An agent that revises its model correctly
  but declines to predict on every telling press will never satisfy R1 and will
  be scored as not recovered. That is deliberate — an uncommitted belief cannot
  be checked without reading prose — but it means `recovered` measures revision
  *plus* willingness to be scored, and the two are not separated.
- `staleRuleActions` counts presses onto the surface that used to end rooms. It
  cannot distinguish acting on a dead rule from deliberately probing it, and a
  careful agent testing its hypothesis is counted the same as a careless one
  acting on it.
- Nothing validates the agent's own `supported_by` / `depends_on` links. It can
  rewrite a claim while keeping the evidence it cited for the old one, and the
  structure will still look rigorous. Treat those fields as what the agent
  asserts, not as verified provenance.
- One rule family, one change, one direction. No A→B→A return, which is the
  cheapest way to tell real revision from fast forgetting and should be the next
  thing added.
- Per-cell n in every protocol is far too small to separate two LLM arms. Treat
  the defaults as a smoke test of the pipeline, not as a comparison.
