# AURA Rooms — research log

Running lab notebook. Append-only, newest entry at the bottom. Entries record
what was actually done and actually observed, including things that did not
work. Nothing in here is a plan; plans live in the README.

Convention: every claim is tagged
`[measured]` (came out of a run or a check),
`[derived]` (follows from code I can point at), or
`[assumption]` (a choice I made that has not been tested).

---

## 2026-09-18 — E0. Framing and the design risk I am building against

The stated research question is whether memory organisation changes how well an
LLM agent recovers from a hidden rule change. Before writing anything I wrote
down the failure mode I consider most likely, so that later entries can be
honest about whether I dodged it:

> **Risk R1 — a fully observable deterministic world makes the question
> degenerate.** If one contradiction is sufficient evidence AND the culprit rule
> is unambiguous, then "selective revision" and "just retest the thing that
> broke" are the same algorithm. Every strategy converges and the measured gap
> between memory conditions is ~0.

This MVP is deterministic and fully observable, by instruction. So I expect R1
to bite. I am building the instrument anyway — the instrument is the
deliverable — but I am recording the prediction now, before any data, rather
than after.

Secondary risks carried forward:
- **R2** — world too small: re-deriving a rule is cheaper than remembering it,
  so memory strategy cannot matter.
- **R3** — variance: LLM agents are high-variance; per-cell n must be large
  enough to separate arms, and this MVP's pilot budget will not be.
- **R4** — context leakage: if prior rules survive in the message history, the
  memory store is not what is being measured. Treated as a code invariant, not
  a note. See E2.

## 2026-09-18 — E1. Engine decisions

`[derived]` Surface effects fire **on entry only** — i.e. only when the action
actually changed the entity's cell. Two required behaviours fall out of that one
rule with no special-casing: a rotation in place does not retrigger the surface
under the entity, and a blocked move triggers nothing. This is in
`src/engine/engine.ts:resolveEffects`.

`[derived]` Slide semantics: advance while the *current* cell is striped and the
next cell is passable. The loop therefore halts standing on the first
non-striped cell, or wedged against an obstacle while still on stripes. A
consequence worth stating because it matters for level design: **the entity can
never skid over the concentric surface**, since that surface is not striped and
so always terminates the slide. No target is ever unreachable because of the
carry.

`[derived]` Termination: the effect resolver carries both an iteration cap (64)
and a visited-pose set. With "effects on entry only" plus a monotone slide,
cycles should be unreachable; the guards are there so that a future surface
cannot hang the engine, and a tripped guard is reported in the step result
rather than swallowed.

Open question for later: the engine is deterministic and exposes the full board,
so R1 stands unmitigated. The cheapest mitigation available inside this spec
would be ambiguous attribution (two surfaces whose composition is observationally
identical), not noise. Not implemented; recorded as future work.

## 2026-09-18 — E2. Solver caught a level that taught nothing

`[measured]` All ten engine checks pass (`npm run verify`). Reference shortest
paths under the original rules:

```
level 1 (5x5) first contact     2  BB
level 2 (5x5) off axis          4  BADD
level 3 (7x7) detour            5  ADADD
level 4 (7x4) the strip         4  BBAD
level 5 (7x7) reorientation     7  BBBABBB
level 6 (9x7) assembly         14  ABBBBADDDDDDDD
level 7 (9x7) the same strip    6  BBBBAD      after change 12  BBBBADDDDDDD
level 8 (9x7) transfer         10  BBBADADADD  after change 13  BBBBBADDDDDDD
```

**Finding — the first draft of level 6 was a dud.** I designed it as the
"combination" room: enter the strip northbound, ride it onto the diagonal, get
re-aimed, walk to the target. The solver's answer was `ADDDADDDDDD` — eleven
presses straight up the open right-hand column, touching neither the strip nor
the diagonal. The room that was supposed to require every earlier lesson
required none of them. Redesigned so the solid mass leaves exactly one way
north and it is the strip; the shortest path is now 14 and provably passes over
both special surfaces.

Worth stating plainly because it generalises: **hand-authored curricula quietly
fail.** I would not have caught this by playing the level, because I would have
played my intended route. The solver is not decoration — it is the only reason
this level does what the design says it does. Any future map must be re-run
through it, and "solvable" is the weaker of the two checks; "solvable only the
intended way" is the one that has teeth.

**Finding — the action set contains a redundancy.** `A` then `D` (turn left,
walk against the facing) and `C` then `B` (turn right, walk along it) produce
identical displacement and differ only in the resulting facing. The solver
prefers the `A`/`D` form almost everywhere, which is why the reference paths
look nothing like the routes I hand-traced. Two consequences:
- `[derived]` An agent can reach targets while holding a self-consistent but
  wrong model of which button turns which way. Success rate alone therefore
  cannot certify that a rule was learned correctly — the per-action prediction
  is what discriminates, which is an argument for keeping the forced prediction
  in the response schema rather than treating it as UI garnish.
- `[assumption]` I am keeping the redundancy. Removing it would make the world
  cleaner but less representative; real action sets have redundant paths.

`[derived]` Boundary check is in place: for every reachable state of every
level, the serialised observation is scanned for 23 forbidden tokens (the 8
named in the spec plus English words that would give a surface's function away).
Currently clean.

## 2026-09-18 — E3. No model credentials in this environment

`[measured]` `ANTHROPIC_API_KEY` unset, `AURA_ENDPOINT` unset, no `ant` CLI
profile. **Zero automated LLM runs have been performed.** The app's pilot sweep
has never been executed. Every number below that involves a model comes from
hand-stepped subagent probes, described and labelled as such. Nothing in this
repository should be read as a pilot result.

## 2026-09-18 — E4. Subagent probes: method, and what it is not

Since no HTTP-reachable model was available, I drove the protocol by hand
through `scripts/smoke.ts`, which imports the real `prompt.ts`, `observation.ts`,
`schema.ts` and `memory.ts` rather than reimplementing them — so a probe cannot
drift from what the app sends. The subject was a Claude Code subagent on Haiku
4.5, one **cold spawn per action**.

The cold-spawn-per-action detail matters: it is not a workaround, it IS the
protocol. AURA requires context rebuilt from scratch each turn with no history,
and a fresh subagent per step satisfies that exactly. Continuing one agent via
a follow-up message would have preserved history and silently broken the
invariant, so it was never used.

**Integrity of the seal.** A subject with file access would simply read
`src/engine/levels.ts` and know every rule, which would void the whole exercise.
I could not register a zero-tool agent definition (it needs a session restart),
so I used a soft seal — an explicit no-tools instruction — plus two checks:
every spawn reported `tool_uses: 0`, and the cold-start reply contained no rule
knowledge (it wrote "Unknown what constitutes room completion"). Both checks
passed on every spawn. This is weaker than a hard seal and I am recording it as
such.

**What these probes are not.** A Claude Code subagent carries the harness's own
system prompt, so this is not the clean stateless Messages API call the app
makes. n=1 trajectory, one small model, and in the second probe the memory was
author-seeded rather than learned. These are prompt smoke tests. They are
evidence about the instrument, not about the world.

## 2026-09-18 — E5. The probe result, and what it does to R1

**Probe A (cold start, room 1, empty memory, 2 actions).** The protocol works.
From a single observation of `A` (up → left, no movement) the subject wrote
"Button A rotates entity marker counterclockwise" and linked a goal hypothesis
to an `entity_position` entry via `depends_on`. Agent-authored dependency links
appear without being coached, which is the mechanism the structured arm needs.

**Probe B (room 7, author-seeded correct memory, rules already changed).**
This is the adaptation moment in isolation. Setup: nine confirmed rules including
a correct `striped` rule and a derived `plan` entry with
`depends_on: ["striped","btn_b"]`.

Unprompted, the subject wrote a room plan — *"Move up to y=2, turn right, then
press B to slide through striped_tiles to goal at (7,2)"*, `depends_on:
["striped","btn_b","btn_c"]`. Exactly the derived-knowledge structure the
experiment wants to watch break.

Then, at the discriminating press, three times in a row:

| step | predicted | actual | `contradiction` | `striped` status | `contradicted_by` |
|---|---|---|---|---|---|
| 6 | carried (1,2)→(7,2), **room completes** | moved to (1,2) | `null` | confirmed | `[]` |
| 7 | carried (2,2)→(7,2), **room completes** | moved to (2,2) | `null` | confirmed | `[]` |
| 8 | carried (3,2)→(7,2), **room completes** | moved to (3,2) | `null` | confirmed | `[]` |

Three explicit, precise, fully falsified predictions. The broken rule was never
touched, never marked suspect, and never accumulated a contradiction. No
contradiction was ever reported.

What it *did* do is the interesting part. At step 7 it **deleted `plan` and
`room7_strategy`** — the two entries that depended on `striped` — and wrote a
fresh positional entry. It revised the **dependents** and left the **root cause**
intact. That is the precise inverse of selective revision: the thing that was
wrong survived, and the things derived from it were churned.

`[measured, n=1, weak model, contaminated harness]` — this is not a result. But
it bears directly on the risk I registered in E0 before writing any code:

> **R1 — a fully observable deterministic world makes the question degenerate.**

R1 assumed that with one contradiction and an unambiguous culprit, any competent
agent revises correctly, so all memory strategies converge and the measured gap
is zero. **On this evidence, R1's premise is false for at least some models.**
The culprit here was maximally unambiguous — a single confirmed rule, one
surface, a flatly falsified prediction — and revision still did not happen, three
times over. Detection was not the bottleneck and attribution was not the
bottleneck. Something else is.

I am not upgrading this to "R1 is dead". A stronger model may well revise
immediately, which would restore R1 in full, and finding that out is exactly what
the pilot is for. What has changed is that the instrument demonstrably *can*
register the failure it was built to measure, which was the open question.

## 2026-09-18 — E6. Three instrument bugs the probes exposed

Running the thing found three faults that reading it did not. All three were in
the fairness of the comparison, which is the part that would have silently
ruined the study.

**1. Whitespace tax on the structured arm.** `JSON.stringify(entries, null, 1)`
puts every `supported_by` integer on its own line. A fully-populated structured
store measured 2728 characters against 2400 of content — it exceeded its own
budget on arrival. Memory is now rendered one entry per line with each entry
compact, and the budget is measured against the exact string that is sent. Same
store: 2302.

**2. An equal budget is not an equal capacity.** Even after the fix, the
structured store sat at 2302 of 2400 with room for nothing more, while the same
knowledge in flat prose is around 900 — structured memory pays for field names
on every entry. A cap that binds hard on one arm and not at all on the other is
a second independent variable wearing a constant's clothing. `MEMORY_BUDGET_CHARS`
is now 6000, chosen so it binds on neither arm. How the formats behave *under*
capacity pressure is a real question and a separate experiment.

**3. The agent was asked to detect contradictions without being shown its own
prediction.** The prompt gave it what happened but not what it had said would
happen. The only way to compare was to have manually copied the prediction into
memory — a bookkeeping burden that falls differently on the two formats and
confounds the exact comparison this study exists to make. The prompt now echoes
the agent's own previous prediction back to it verbatim. This leaks nothing: it
is the agent's own output.

Bug 3 also means the probe in E5 is **not clean evidence about revision** — the
subject may have failed to flag a contradiction partly because it could not see
what it had predicted. The E5 finding should be re-run against the fixed prompt
before anyone leans on it. Recording this rather than quietly re-running and
reporting only the better-looking number.

## 2026-09-18 — E7. Echoing the agent's own prediction changes the outcome

Re-ran probe B's decisive revision step with exactly one variable changed: the
prompt now echoes the agent's own previous prediction back to it. Same model,
same seeded memory, same room, same entity pose, same observation. Probe3 (no
echo) vs probe4 (echo):

| | probe3, no echo (3 consecutive turns) | probe4, with echo |
|---|---|---|
| `contradiction` reported | `null`, `null`, `null` | substantive, naming the mismatch |
| `striped` status | stayed `confirmed` | **`suspect`** |
| `striped.contradicted_by` | `[]` | `[47]`, then `[47,48]` |
| unrelated rules touched | none | none |
| dependents (`plan`, `room7_strategy`) | churned while root kept | dropped, root demoted |
| next press | repeat the falsified plan | same press, but as a stated test |

With the echo, the subject then recovered a correct behavioural model in two
further steps: it proposed "carry only triggers when *starting* from a striped
tile", tested it by pressing from a striped tile, watched that fail too,
accumulated `contradicted_by: [47,48]`, and wrote `room7_no_carry` — "auto-carry
does not operate in room 7; only single-cell moves occur". Its prediction for the
next press was correct for the first time since the change. Throughout, the six
rules that had not changed stayed `confirmed` and untouched: **zero false
revisions**.

`[measured, n=1 per arm]` One trajectory each. This could be sampling noise and
must be replicated before it is believed. But the direction is strong and the
mechanism is obvious in the transcripts, so it is worth stating what it would
mean if it holds:

> **A large part of what looks like "the agent failed to detect the change" may
> be the harness failing to show the agent what it predicted.**

That matters for the study design well beyond a prompt tweak. The planned metric
"how quickly does the agent notice its knowledge is stale" is not purely a
property of the agent or of its memory organisation — it is partly a property of
what the protocol hands back each turn. Withholding the prediction measures the
agent's note-taking discipline, and note-taking discipline is exactly the thing
that differs between a flat blob and a schema with a `contradicted_by` field.
The two arms would have been separated by a bookkeeping artefact that has
nothing to do with belief revision.

So the echo is not a convenience. It is what isolates *revision* from
*bookkeeping*, which is the comparison the project claims to be making.

**Revised note on R1.** E5 read as "even an unambiguous contradiction fails to
trigger revision". E7 shows that conclusion was partly an artefact of my own
prompt. The honest statement is narrower: under this protocol, whether revision
happens at all is sensitive to a harness detail, and both the failure mode and
the clean-revision mode are reproducible on demand. The instrument can produce
both, which is what makes it an instrument. Whether a *stronger* model needs the
echo at all is unknown and is the first thing a real pilot should measure.

**Caveat carried forward.** Probe4's memory was author-seeded, its approach
presses were auto-advanced rather than re-queried, and both probes ran through a
Claude Code subagent that carries its own system prompt. None of this is a pilot.

## 2026-09-18 — E8. Shipped state and what was actually verified

`[measured]` `npm run check` — 27 checks, 0 failures.

Engine and level set (10): grids well formed and exactly one target each; every
map solvable under every rule set it must support; stepping deterministic across
all states × buttons × rule sets; rotation in place never triggers a surface;
a blocked press changes nothing but still costs the action; the rule change
alters striped surfaces and nothing else; the target can never be skidded over;
the cycle guard never trips; no reachable observation leaks a forbidden token.

Agent loop and boundary (17): no forbidden token in either strategy's full
prompt; the announced-change notice names no rule; each arm is told only its own
format; both arms get equal permission to self-correct; the prompt is a pure
function of its arguments (no hidden history); the prediction echo appears only
when there is one; malformed replies are rejected and perform no action; JSON
extraction survives fences, chatter, and braces inside strings; over-budget
memory is rejected and the previous memory kept; the budget binds on neither arm
at a realistic load; memory survives room changes and a fresh run inherits
nothing; a new room resets the pose but not the knowledge; the notice fires once
and only in its condition; the intervention fires on entering room 7 and never
when stable; a branched continuation carries memory, applies the change on
arrival, and does not share memory objects with its parent; a hand-forced change
tags the run; an exhausted budget is recorded as a failure rather than skipped.

`[measured]` Verified by hand in the browser: manual play solves room 1 and
advances; the random agent runs unattended and exercises blocked presses; the
replay viewer scrubs a recorded probe and reports **"engine reproduces this
recorded step exactly"** on the step where the change bit.

`[measured]` Incidental find while writing the boundary tests: the prompt used
the words "carry forward" and "carries from turn to turn" in an unrelated sense
(about memory persisting). Harmless in meaning, but it put the word most likely
to describe the striped surface's behaviour in front of an agent whose job is to
discover that behaviour. Reworded. Costless to remove, impossible to rule out
after the fact if left in.

### Open, in the order I would do them

1. **Re-run E5/E7 with more than n=1.** The echo effect is the load-bearing
   finding so far and it rests on one trajectory per arm.
2. **Does a stronger model need the echo at all?** If Opus revises immediately
   without it, R1 comes back and the world needs to get harder.
3. **A→B→A return.** Not implemented, and it is the cheapest way to separate
   real revision from fast forgetting — a recency-shaped memory looks excellent
   at adaptation and terrible at return.
4. **Ambiguous attribution.** Two surfaces whose composition is observationally
   identical. This is the direct answer to R1 and is cheaper than adding noise.
5. **Then, and only then, a pilot with enough seeds to separate two arms.**

## 2026-09-19 — E9. External review: three real bugs, and a curriculum rebuild

An external review read the code, the log and all three committed JSONL files at
`6b32603`, ran the 27 checks independently, and found several things the checks
did not. Every finding was correct. Recording them as found, not as softened.

**1. The agent never saw the result of its winning press.** `advanceLevel()`
loaded the next room and cleared `lastAction` in the same breath, so the press
that ended a room produced a next-observation belonging to a DIFFERENT room with
nothing attached. The agent was being asked to infer what ends a room while
being denied the one observation that shows it. Worse, exhausting the budget
also advanced the room, so from the inside success and failure were
indistinguishable.

This is the most serious defect found so far, because it attacks the premise of
the whole design — "the agent can connect its action, the cell and the success".
Fixed with a `previous_room` block on the first observation of each room,
carrying the closing press, the cell it landed on, and an explicit outcome of
`completed` or `ran_out_of_actions`. It reports what happened, not why, so it
gives nothing away.

**2. `memory_before` and `memory_after` were always identical.** The memory
update was applied before `commit()` ran, and `commit()` then read it back off
state as both fields. Every one of the 18 recorded steps claimed the agent had
seen the memory it had just written. The log could not answer the one question
it exists to answer — what did the agent know when it chose? Replaced with three
distinct fields: `memory_in_prompt`, `memory_proposed`, `memory_accepted`, plus
`memory_update_rejected`. The ambiguous `memory_before` name is gone entirely so
nothing can silently read the wrong one again.

**3. Room 8 was solvable optimally without either mechanic it claimed to
teach.** Banning both special surfaces still solved it in exactly the optimal
post-change length. Same defect I had already found and fixed in room 6 — and I
still shipped it in room 8, because I fixed room 6 by hand and never turned the
fix into a check.

That is the real lesson, and it is now a test. `solve()` takes a `banned` option,
every room declares `requires`, and `npm run verify` bans each declared surface
and asserts the room becomes UNSOLVABLE. A room that claims to teach the strip
must be impassable without it. There is also a new check that the intervention
rooms' cost gap is at least 5 actions, because a room where the carry saves one
or two presses lets an agent limp along on a stale rule without ever paying for
it.

**4. One of my own tests was enshrining bug 1.** `'a new room resets the pose but
not the knowledge'` asserted `lastAction === null` after a room change and called
that correct. 27 green checks certified a broken design. Rewritten to assert the
opposite, plus a test that running out of actions is reported as such.

### The control scheme changed

Buttons are now four absolute directions instead of turn-left / forward /
turn-right / back. Two reasons. The turn-relative scheme had a redundancy — "turn
left then walk backward" and "turn right then walk forward" give identical
displacement — so an agent could succeed while holding a wrong-but-consistent
model of turning. And pinning the scheme down consumed most of a room's budget,
which is budget not spent on the surface rules. A surface rule is what the
experiment changes, so that is where the budget belongs.

The diagonal surface had to be redefined: with no heading to rotate, it now
deflects travel 90 degrees clockwise and carries on one cell. Room 5 was rebuilt
around it, because in the first redraft the deflector fired into a wall and did
nothing — the room passed "solvable" AND passed "requires the diagonal", since it
was required merely as a place to stand. Being required is not the same as being
demonstrated, and no test I have catches that difference; it took reading the
solver's chosen path.

All eight rooms were rebuilt. Reference lengths under the original rules:
1:4, 2:6, 3:8, 4:4, 5:9, 6:4, 7:2, 8:13. Rooms 7 and 8 after the change: 8 and
20 — gaps of 6 and 7.

## 2026-09-19 — E10. First genuine continuous run

`[measured]` Cold start, empty memory, structured store, room 1, sealed Haiku
subject, **every press chosen by the model**, nothing auto-advanced, nothing
seeded. `tool_uses: 0` on all eight spawns. Log:
`runs/archive-engine-v2/live-cold-*.jsonl`.

It solved room 1 in 8 actions against a reference of 4. The extra four were not
waste — they were spent identifying the button set:

| step | press | why | outcome |
|---|---|---|---|
| 1 | A | "test whether A moves the entity" | up one cell |
| 2 | B | deliberate probe of an untested button | right one cell — prediction of "left" falsified, contradiction reported |
| 3 | C | test the generalisation | down one cell, as predicted |
| 4 | D | "completing the cardinal direction pattern" | left one cell |
| 5–8 | A×4 | execute the plan | room completed |

What the memory did, unprompted:
- **Self-corrected without being challenged.** Step 1 recorded the target at
  (0,0); step 2 silently rewrote it to (2,0), the correct cell.
- **Induced a general rule from two instances and labelled its own
  uncertainty** — `cardinal_pattern`: "A=up, B=right, C=down(?), D=left(?)",
  status `hypothesis`, `depends_on` the two confirmed button entries. The
  question marks were its own.
- **Promoted it on evidence.** After D it became `confirmed` with
  `supported_by: [1,2,3,5]`, then accumulated 6, 7, 8.
- **Built a derived plan on top of it** — `path_to_goal`, `depends_on:
  ["cardinal_pattern"]`. That is exactly the root-and-dependent structure the
  intervention is designed to break, and it arose on its own.

`[measured]` The complete button model was learned in four presses, which is
what the absolute-direction change was meant to buy and it delivered.

**My own error, recorded rather than quietly fixed.** At step 6 I hand-typed the
`last_action` block into the prompt instead of pasting the harness's output, and
wrote `before.marker` as "up" when it was "left". The agent duly reported a
contradiction about its own state tracking. **That step-6 contradiction is an
artefact of my transcription, not agent behaviour, and step 6 of that log should
be treated as contaminated.** It is also a concrete instance of exactly what the
review warned about — a hand-driven protocol with no saved prompt cannot be
audited. The app's runner now logs `prompt_user` per step and the full system
prompt once in `run_start`, so a real run is reconstructible without trusting me.

### Still missing, unchanged by any of this

- **No flat-memory run exists, so no strategy comparison exists.** Every model
  trajectory to date is structured-memory.
- No run has yet reached the intervention from self-accumulated experience. The
  only adaptation evidence is still the author-seeded probe in E5/E7.
- The E7 echo effect is still n=1 per arm and still confounds two changes
  (showing the prediction, and asking for a comparison).

## 2026-09-19 — E11. Making the experiment checkable, and the behaviour legible

Two problems, one cause: nothing in a run could be *scored*, and nothing in the
UI showed what the agent was doing.

**The scoring problem.** The agent predicted in free text — "it will slide to the
far side and the room will end". That reads well and cannot be checked. The only
way to score it would be to have something read the prose and judge it, which
manufactures a measurement out of writing quality and would rate a well-written
wrong answer above a terse right one. So the reply now carries an optional
`predicted_position: {x,y}`. A coordinate compares with `===`. `null` means
"declined to commit" and is never counted as wrong, so honesty is not punished.

That one field turns everything downstream into arithmetic. **Recovery is now
defined in advance**: three committed correct predictions in a row, after the
change. Three rather than one, because a single correct prediction after a change
is as likely to be luck as understanding — and "first success" and "recovered"
are reported as separate events, since collapsing them is the easiest way to
overstate a result. Declining breaks the streak without counting against the
agent.

`src/metrics.ts` computes, from recorded positions and statuses only: prediction
accuracy, first telling press, first correct prediction after the change, first
room solved after it, the recovery step, and **missed chances** — telling presses
made while still predicting wrongly, the closest honest proxy for "kept acting on
the dead rule". Beliefs demoted after the change are listed but **not labelled
right or wrong**; whether doubting a given belief was correct is left to a human,
because deciding it requires reading the claim.

**The legibility problem.** The raw log is unreadable at speed. Memory is a wall
of JSON that changes slightly every turn, so the one moment that matters — a
belief being demoted — looks identical to every other turn. Three views now:

- **Belief timeline** — one row per belief, one cell per step, coloured by
  status, derived beliefs indented under what they depend on. A row that runs
  green and turns amber at one column *is* the revision moment, and which
  neighbouring rows stayed green is the whole question.
- **Prediction ledger** — step, room, button, predicted cell, actual cell,
  hit / miss / abstain, with the rule change drawn as a break in the list.
- **Measured** — the metrics above, with recovery's definition stated on screen.

They work on live runs and on loaded recordings, so the committed `live-cold` log
can be inspected directly. Doing that paid off immediately: the timeline shows
`cardinal_pattern` sitting violet as a hypothesis and turning green the step after
the fourth button was tested, with `path_to_goal` indented beneath it. That was in
the log all along and I had only found it by reading JSON by hand.

`[derived]` That same log shows `accuracy: — (0/0 committed, 8 declined)`, because
it predates `predicted_position`. Correct, and worth keeping visible: it says the
run cannot answer the question rather than implying a score.

**Experiments are now declared, not clicked.** `src/experiment.ts` holds named
protocols, each carrying the question it asks and what would count as an answer,
both fixed before the run. Choosing arms from dropdowns meant the design lived in
whatever happened to be selected, and a log could not later distinguish intent
from accident. The three protocols are a pipeline smoke test, the flat-versus-
structured comparison, and hidden-versus-announced. Each states its own cost in
model calls before anything is spent.

41 checks now, the metrics included: that declining is not scored as wrong, that
a lucky hit is not a recovery, that an abstention breaks a streak, that pre-change
steps cannot produce a recovery, and that flat memory yields no belief tracks
instead of crashing.

**Still the same gap.** None of this has been run against a model. It makes the
next run measurable; it does not substitute for it.

## 2026-09-19 — E12. Engine v3: the rule change becomes fatal

The striped surface is gone. On the user's proposal the rule change is no longer
"the carry switches off" but "the goal surface and a lethal surface trade
meanings". Both are drawn as siblings — concentric rings and radial spokes, same
palette — and neither changes appearance when the swap happens.

**Why this is a better change than the one it replaced.** The old change cost the
agent moves: it still reached the target, just slower. This one costs it the
room. Acting on stale knowledge stops being expensive and becomes fatal, which
also creates a dynamic the old design had no room for — an agent that suspects a
change should probe rather than walk confidently onto what it "knows" is the
goal.

`[assumption]` **It also changes what is being measured, and that is not a free
upgrade.** Detection becomes trivial: you step on the goal and die, which is
unmissable. The weight of the experiment shifts from noticing onto recovering.
Given E7's finding that detection is largely a harness artefact anyway, that is
arguably an improvement, but it should be stated rather than glossed.

**Temptation is inherent, not contrived.** The agent sees two matched symmetrical
figures and cannot know which one it wants. It needs no artificial shortcut to be
lured onto the lethal one — only for the lethal one to be nearer, which is how
the early rooms are laid out. Chosen over forcing a death because the user asked
for temptation rather than coercion; the risk that a cautious agent reaches the
intervention never having touched one is real, deliberate, and part of what the
design is testing.

**Two design faults the checks caught, both fatal to the experiment.** Rooms 5
and 7 each had the radial surface reachable *only by walking over the rings*.
Under the original rules that is merely a detour; after the swap the winning
surface sits behind a lethal one and the room is unwinnable. Neither was visible
by playing — both came out of a new check that both marked surfaces must be
reachable under both rule sets.

Room 7 is now the sharpest room in the campaign: **11 presses under the original
rules against 4 after the swap, by opposite routes.** The short right-hand column
is lethal before the change and correct after. An agent carrying the old rule
walks onto the rings and dies; the other surface is one cell away, so the room
still measures recovery rather than luck.

`[derived]` `requires` is now checked under the ORIGINAL rules only, and the
reason is in the code: the swap changes which surface the room is aiming at, so a
claim about the route to the rings says nothing about the route to the radial.
All the teaching happens before the change, so the teaching claim is the one
worth enforcing.

## 2026-09-19 — E13. The same bug, a third time

First run on v3. The agent stepped onto the radial surface on step 2 — exactly as
the layout intended — died, and wrote:

> `no_return_rule`: "Entity dies when returning to starting position after moving
> away."

It never connected the death to the surface. **It could not.** The observation
carried `before` and `after` poses, and after a death the `after` is the respawn
point, so the lethal cell appeared nowhere in anything the agent could see.

This is the third time the instrument has withheld the one observation the agent
needed, after the winning press (E9) and the agent's own prediction (E7). The
pattern is worth naming: **every one of these was invisible to the test suite and
only appeared when a real agent reasoned from what it was actually handed.** Unit
tests check that the code does what it says. They cannot check that what it says
is enough to reason from.

Consequence had it shipped: the lethal surface would have been permanently
unidentifiable, so recovery from the swap would have been impossible rather than
hard, and every press of the campaign would have been wasted.

Fixed — `last_action.died_at` reports the cell, with a check asserting the
reported cell really is the lethal glyph under the rules in force. After the fix
the agent wrote, on step 2 and unprompted:

> `radial_deadly`: "Radial tile at (2,2) kills entity; entity died when moving
> toward it." — **confirmed**

That is the prerequisite for the whole swap experiment, earned rather than
seeded, and it now exists.

## 2026-09-19 — E14. The epicycle behaviour replicates across engine versions

`[measured]` Cold start, empty memory, structured store, **stable condition**,
budget 15, sealed Haiku, every press model-chosen. 14 presses, 3 deaths, **room 1
not solved**. Accuracy 55% (6/11 committed, 3 declined). Log:
`runs/archive-engine-v3/v3run-*.jsonl`.

> **Correction, 2026-09-19 (E16).** This entry originally said "hidden
> condition". The log says `"condition":"stable"`, and stable is what it was. The
> discrepancy changed nothing about the finding — the run never left room 1, so
> it never reached the intervention and the condition was never exercised — but
> the entry was asserting a fact the evidence it cited contradicted. Fixed in the
> prose rather than in the log: a recorded run is data, and editing it to agree
> with a claim about it is the wrong direction of fit. See E16 for why *every*
> hand-driven run in this repository was a stable run regardless of its config.

It learned the button set correctly and quickly — and notably, it **abandoned a
wrong frame rather than defending it**, which the v2 run never did:

```
step 3   btn_a_moves_opposite   -> confirmed   (wrong: read the respawn as a move)
step 4   btn_b_clockwise        -> confirmed   (wrong: turn-relative)
step 6   btn_a_unclear          -> suspect     (demoted its own claim)
step 7   btn_a_move_up          -> confirmed   correct
         btn_b_right_marker     -> confirmed   correct
         btn_d_left_marker      -> confirmed   correct
```

It even logged `step7_error` against its own bookkeeping rather than blaming the
world.

**Then it lost the room to exactly the failure mode this project is about.**
Having established that the radial surface killed it, it would not accept the
simple rule. Three deaths on the same cell, each followed by a narrower
condition rather than a retraction:

| after death | what it wrote |
|---|---|
| 1st | "radial_tile at (2,2) kills entity" — correct |
| 2nd | "kills **when marker is up**" — narrowed, then tested marker=right, died |
| 3rd | "safe if **marker matches movement direction**" — tested marker=up moving up, died |
| — | "previous hypothesis of marker-match safety was false... appears unconditionally deadly" |

It reached the right answer on the fourth attempt, then spent its remaining
presses testing a *fourth* variant instead of finishing the room, and ran out of
budget.

`[measured, n=1 per engine]` **This is the same behaviour as the v2 run, on a
completely different mechanic.** On v2 it defended a turn-relative button model
with "B rotates until it finds an open path"; on v3 it defended a conditional
lethality model with "safe if the marker matches". Two engine versions, two rule
families, same shape: *preserve the root claim, add conditions to it*. That makes
it the most replicable observation the project has produced, and it suggests the
behaviour is a property of the model rather than of this world.

`[derived]` It also repeated the v2 over-generalisation verbatim —
`btn_c_inert: "Button C does nothing"` — confirmed from a single press blocked by
the grid edge. Twice, across two engine versions.

**Budget note.** 15 presses per room is too tight for an agent that spends this
heavily on hypothesis tests. Room 1's reference path is 6. Future runs should use
25-30 and let the failure be about reasoning rather than about the allowance.

## 2026-09-19 — E15. Hand-driving the protocol does not scale, and the fix

`[measured]` Driving the loop one sealed subagent per press costs roughly **20x
more than the work it does.** Each spawn burns about 50,000 tokens rebuilding an
entire agent harness before it reads the ~2,500-token prompt it is there to
answer. The 14-press run above cost on the order of 750,000 tokens to produce
about 40,000 tokens of actual reasoning.

That trade was right for a five-step probe, where the alternative was no evidence
at all. It is wrong for a campaign, and it was the user who spotted it.

`scripts/campaign.ts` runs a whole campaign headlessly, sending exactly the
prompt and nothing else. It deliberately imports the same prompt, observation,
validation, memory and metrics modules the browser runner uses, so a headless run
and a watched run are the same experiment and produce the same replayable JSONL.
It refuses with a clear message when no model is reachable rather than
pretending.

```
ANTHROPIC_API_KEY=... npm run campaign
AURA_ENDPOINT=http://localhost:11434/v1 AURA_API_KEY=x AURA_MODEL=... npm run campaign
```

`[assumption]` The local-endpoint route costs nothing and needs no key, and is
the fastest way to get the first complete campaign. A weaker local model will
play worse, but "does the pipeline survive eight rooms end to end" does not need
a strong one, and that question has still never been answered.

### Standing gaps, unchanged by any of this

- **No flat-memory run exists.** Every model trajectory across all three engine
  versions used structured memory. The project's headline question remains
  untested.
- No run has reached the intervention from self-accumulated experience. On v3 the
  furthest any agent has got is room 1, unsolved.
- The E7 echo finding was measured on v1 and has never been reproduced since two
  engine rebuilds.

---

## 2026-09-19 — E16. AURA v4: the project was measuring the wrong thing, in four places

`[derived]` The framing changes. AURA is no longer *"does structured memory
recover better than flat memory"*; that is now a sub-experiment. The question is:

> Can an autonomous agent discover the rules of an unknown world, use them across
> levels, detect when a previously reliable rule silently changes, and revise its
> world model efficiently?

Memory format is one variable inside that. It presupposes there are beliefs to
store, and nothing in the old curriculum was built to watch them being formed.

Four defects were found while rebuilding for it. Two of them were silently
distorting the experiment rather than breaking it, which is the worse kind.

### 1. Every arm was warned that the rules might change

`[measured]` The system prompt ended with *"The rules of this world are usually
stable, but they are not guaranteed to stay that way."* That sentence was in
`COMMON` — the block shared by **all three conditions**.

So the `hidden` arm, whose entire definition is that it is not warned, was
warned. The `stable` arm was warned about something that never happens to it. And
the `notified` arm's one sentence, which was supposed to be the only thing
separating it from `hidden`, was no longer separating anything. The project's
central comparison had been collapsed since the first commit, by one sentence
that reads like good practice.

Also removed: *"Be willing to spend a press on a deliberate test… a press that
resolves an uncertainty is usually worth more than a press that acts on a
guess."* That is the experimental strategy being handed to the subject. Whether
an agent probes is part of what is under study, and E14's whole finding is about
how it spends presses.

What is left is the mechanics of a turn plus one line: *"Explore the environment
and progress as far as you can."* The test is absolute rather than phrase-based —
the word `rule` must not appear anywhere in what a hidden-arm agent is sent —
because a phrase list only catches the wording you thought of.

### 2. No hand-driven run ever applied the rule change

`[measured]` `scripts/smoke.ts` declared `maybeIntervene` **inside**
`observation()`. One stray brace. Nothing could call it, so no hand-stepped run
ever swapped the surfaces, whatever `--condition` it was started with. Every
`structured-hidden-manual-*.jsonl` in the archive is a `stable` run.

No published finding changes — the furthest any hand-driven run ever got was room
1, so none of them reached room 7 — but the next one would have been silently
wrong, and it would have looked like a null result about agent behaviour.

It survived because `scripts/` and `server/` were **not typechecked**. Only `src`
was, and Node's type-stripping ignores types entirely at runtime, so a type error
in a script was invisible forever. `npm run typecheck` now covers both projects,
and the unused-symbol check found this on the first pass.

`[derived]` The same blind spot explains why this was findable at all: the file
had a dead function for its entire life and every test passed. Tests check that
code does what it says. They cannot check that what it says is enough.

### 3. Recovery could be achieved by walking in a straight line

`[measured]` The old criterion was **three consecutive correct predictions after
the change**, on a single `predicted_position` field. Three presses down an empty
corridor satisfy it. An agent that had revised nothing could score a recovery for
being able to count squares, and the number would have looked perfectly
respectable in a table.

The fix required an instrument the project did not have. Every press is now
resolved **twice** — under the rules in force and under the other set — and the
engine records `divergent_fields`: exactly which of the observable outcomes read
differently between them. An ordinary move has none.

**Recovered = R1 ∧ R2**, where

- **R1** = a correct prediction on a field in `divergent_fields`, after the
  change. A press that could not have revealed the change cannot contribute.
- **R2** = a room finished after the change.

`recoveredAtStep` is whichever landed last. Transfer to room 8 is reported
separately, not folded in: it is a much harder bar, and a conjunction including
it would be false for nearly every run in every arm. A metric that is always zero
separates nothing.

Also tracked now: `firstEvidenceStep` (the first press that *could* have revealed
the change), `detectionDelay` measured **from that** rather than from the
intervention — measuring from the flip punishes an agent for time it had no way
to use — `staleRulePredictions` (wrong in exactly the way the dead rule was
wrong), `staleRuleActions`/`staleRuleDeaths`, and `collateralDrop`, the accuracy
lost on fields the change did *not* touch. That last one is the only collateral
measure that works for both arms: a flat store has no statuses to demote, so
belief bookkeeping cannot compare them.

### 4. `predicted_position` was too weak, and an event enum would have leaked

`[derived]` One coordinate cannot express "I expect nothing to move" distinctly
from "I expect to be sent back to where I started" when the start happens to be
where you already are. Four independent claims can: `end_position`,
`position_changed`, `returned_to_start`, `room_changed`, each nullable, each
compared with `===`.

The obvious richer design is an event label — *move / blocked / deflected /
death / room_complete*. It was rejected for two reasons.

**It leaks.** Those words sit in the system prompt from turn one. An agent in
room 1, which now contains nothing that can hurt it, would be told that dying and
being deflected are things this world does — two rooms before the first is
introduced and four before the second. The curriculum's entire value is that each
idea arrives exactly once.

**And a single label forces a precedence rule** when a press does two things at
once (deflected *onto* the exit), so the agent would be scored partly on guessing
a labelling convention.

The same discipline was applied to the observation. `died` became `came_from` —
the last cell occupied before coming to rest, always present, no special case —
and `level_complete` became `room_changed`. `previous_room.outcome` is now
`ended_by_action` / `actions_exhausted` rather than `completed` /
`ran_out_of_actions`. Every field is now something a person watching the screen
could read off without knowing a single rule. The forbidden-token list grew from
30 to 48 and now bans event causes, not just surface functions.

`[derived]` The leak audit also changed shape. Plain substring matching became
unusable once ordinary English words entered the list — *knowing* contains `win`,
*audience* contains `die`, *close* contains `lose`. Tokens now match at the start
of a word only, which keeps every inflection (*killing*, *deadly*, *deflected*,
*completed*) and drops the false alarms. A check that cries wolf gets deleted.

### The curriculum, rebuilt

| # | room | teaches | lethal surface? |
|---|---|---|---|
| 1 | controls | the four buttons | **none** |
| 2 | the same shape | that a *surface* ends rooms, not a square | **none** |
| 3 | the straight line | the lethal surface, sitting on the obvious route | yes |
| 4 | two doors | transfer, as an equidistant forced choice | yes |
| 5 | reorientation | the deflector, load-bearing | yes |
| 6 | assembly | all of it, nothing new | yes |
| 7 | the same two | *the swap has already happened* | yes |
| 8 | transfer | revised rule + the deflector rule that never changed | yes |

`[measured]` Room 2's first draft was solved by `AABB` — **the identical sequence
that solves room 1**. Its entire job is to confirm that the surface ends the room
rather than the square or the sequence, and an agent could have satisfied it by
replaying four presses. Caught by writing the assertion, not by playing. There is
now a test that no two rooms share a solution.

`[measured]` Rooms 1–6 need only be solvable under the original rules; only 7 and
8 are played under both, because only they are reached after the change and the
`stable` arm reaches them unswapped. That relaxation is what makes hazard-free
rooms 1–2 possible at all: under the swapped rules the rings themselves kill, and
every room needs rings to be finishable. So "hazard-free" and "played under both
regimes" are checked *against each other* — a room cannot claim both.

New tests, 66 in total (was 41):

- rooms 1–2: **no press from any pose is fatal**, and neither room can ever be
  reached by the swap
- the hazard appears first in room 3, the deflector first in room 5, and the
  deflector is learnable before the change
- no two rooms share a solution
- room 7 is contradictory in the strong sense: the pre-change solution is fatal
  after the change **and** the post-change solution is fatal before it, and the
  post-change route is the shorter one, so failing to revise costs more than it
  saves
- rooms 7–8 are finishable **through the runner**, in all three conditions,
  within budget — not merely solvable on paper
- ordinary movement accuracy cannot trigger recovery (ten consecutive correct
  ordinary predictions plus a finished room ⇒ `recovered === false`)
- an ordinary move produces no divergent fields, exhaustively over room 7
- the hidden prompt never contains the word `rule`; the announced prompt contains
  it only inside the notice
- the response schema names no cause

### Standing gaps, and two new ones

- **No v4 data exists.** Not one model call has been made against the new
  curriculum, prompt, schema or metrics. Everything E5–E15 describes is an
  instrument that has since been rebuilt in four places.
- Archived runs **cannot be rescored**. A v3 step recorded one
  `predicted_position`; a v4 step records four claims, and every metric derives
  from the latter.
- **No flat-memory run exists**, across four engine versions.
- `[assumption]` **R1 requires the agent to commit.** An agent that revises
  correctly but declines to predict on every telling press scores as not
  recovered. That is deliberate — an uncommitted belief cannot be checked without
  reading prose — but it means `recovered` measures revision *plus* willingness
  to be scored, and nothing here separates them.
- `[assumption]` `staleRuleActions` cannot tell deliberate probing from acting on
  a dead rule. A careful agent testing its hypothesis is counted the same as a
  careless one relying on it. Given that E14's central finding is *about* how the
  agent spends probes, this is the weakest of the new metrics.
- Still one rule family, one change, one direction. No A→B→A return.

---

## 2026-09-19 — E17. The first v4 run: recovered by the criterion, unrevised by the transcript

`[measured]` The first automated run on this engine, and the first run in the
project's history to reach the rule change on self-earned knowledge. Log:
`runs/codex-v4-2026-09-19T1208.jsonl` (committed, replays exactly), summary in
`runs/codex-v4-2026-09-19T1208.summary.json`, console trace in
`runs/codex-v4-console.log`.

Subject: `codex exec · gpt-5.6-luna`, sealed (see README). Structured memory,
**hidden** condition, 25 presses per room, every press model-chosen, nothing
seeded. 114 presses, 114 model calls, 1.61M tokens, of which roughly 11,700 per
call is codex's own scaffolding. **0 malformed replies. 0 tool uses.** One
`seal_alarm` at step 50 — a codex `error` item in the event stream, not a
command or file read; `leaky: false`; the reply itself was a valid press. The
seal held.

**The run was interrupted and resumed.** Step 50's call exceeded the 300 s
timeout (median call 24 s, p90 33 s, worst 103 s — an outlier hang, not the
prompt growing) and the runner treated a provider error as fatal. Nothing
carries between presses except the memory store and the last observation, both
of which are in the log, so `campaign.ts` gained `--resume`: it rebuilds the
state from the log and asks the next press from exactly where the last one
stopped. That this is exact is now a test — hydrating from any prefix of any log
in `runs/` reproduces the next step's `prompt_user` byte for byte, 86 prefixes
across five logs including the browser runner's. The seam is at step 49, marked
by a `run_resume` record; the first press after it continued the agent's stated
plan and was correct. A press is now also retried after a provider error, with
every attempt logged.

### Rooms

| room | presses | reference | deaths | |
|---|---|---|---|---|
| 1 controls | 6 | 4 | 0 | two spent telling buttons apart |
| 2 the same shape | 4 | 4 | 0 | optimal — and the winning press was a MISS |
| 3 the straight line | 20 | 6 | 5 | all five on the same cell |
| 4 two doors | 6 | 5 | 0 | chose the rings, correctly, first time |
| 5 reorientation | 17 | 9 | 4 | all four on the same cell, identical press pairs |
| 6 assembly | **failed** (25) | 19 | 0 | 25/25 predictions right, never approached the rings |
| — swap — | | | | |
| 7 the same two | 16 | 4 (11 before) | 1 | the stale-rule death, then the other tile |
| 8 transfer | 20 | 10 | 0 | never touched the rings |

Accuracy 93% (412/445 committed fields; 2 presses committed nothing).

### The pre-registered numbers

```
change applied      entering room 7 (first press under new rules: 79)
first evidence      90      the rings, walked onto by the long route
R1 revised          90      delay after evidence 0, after change 11
flagged             91
R2 room after       94
RECOVERED           step 94
transfer            step 114
stale rule          3 predictions, 1 action (fatal)
collateral          2.5pp accuracy drop on fields the change did not touch
demoted after       none
```

By the criterion fixed in E16, this run **recovered** and **transferred**. The
rest of this entry is about why those two words are doing more work than the
transcript supports, and what the instrument should do about it.

### Finding 1 — every death was blamed on a button

`[measured]` Ten deaths. Ten self-reported contradictions on the following
press. **Every one of them names a button as the subject, and none names a
tile.** The first three, verbatim:

> step 13: "Button A moved the entity from (2,3) to (2,4), contradicting the
> earlier assumption that A always moves upward."
> step 17: "Button B did not move from (1,2) to (2,2); it relocated the entity
> to (2,4) in the same room."
> step 19: "Button A moved the entity from (2,3) to (2,4), contradicting the
> assumption that A always moves upward in room 3."

The observation on each of those presses carried `came_from: (2,2)` — the
lethal cell — and an `after` two rows away from it, which is not adjacent. The
information E13 was rebuilt to provide was on every screen and was used on none.

What the memory did with it is the measurable part. The final store's
`contradicted_by` lists, classified against the researcher record of what each
press actually was:

| entry | contradicted_by | what those presses were |
|---|---|---|
| `btn_a` (**suspect**) | 13, 19, 25, 32, 39, 41, 43 | 6 deaths, 1 blocked press |
| `btn_b` (confirmed) | 17, 23, 85, 91, 113 | 3 deaths, 2 blocked presses |

Nine of twelve contradictions filed against buttons were deaths. The button
beliefs were **correct throughout** — the run's 93% accuracy is mostly the
button model working — and the agent spent the campaign demoting and
conditioning them: `btn_a` ends the run `suspect`, "usually moves upward when
the path is open, but can trigger nonlocal movement". The first belief about
the lethal tile at all (`radial5`, "relocates the entity to the room start") is
written at step 45, after the ninth death, and scoped to one room.

`[derived]` This is a different failure from E14, and the instrument now
separates them. E14's Haiku formed the tile rule after the first death and then
defended it with conditions ("kills when the marker is up"). This subject never
formed one; the epicycles went onto the correct belief instead. Same outer
shape — preserve the root, add conditions — but the root that gets preserved is
whichever belief the agent has, and here the only belief it had was about
buttons. **Misattribution of an anomaly to the wrong rule is not measured by
anything in `computeMetrics`.** `collateralDrop` looks only at accuracy after
the change, and this damage happened before it. A measure is available without
a judge: for each belief whose id names a button, the share of its
`contradicted_by` presses that were deaths. Call it the blame ledger. Proposed
for the next run, below.

### Finding 2 — a solved room is not a learned rule

`[measured]` Room 2 was solved optimally and the winning press was a MISS: it
walked onto the rings predicting `room_changed: false`. Room 5 was the first
room in which it predicted a room ending before it happened. Room 8's winning
press committed `room_changed: null`. Across 114 presses it committed to a room
ending exactly once. The agent reaches exits; it does not predict them.

### Finding 3 — the deflector was never learned, and room 6 fell to planning

`[measured]` The diagonal carried the entity once in the whole run (step 51,
room 5, A from (1,2) landing at (2,1)). The contradiction was correct — "landed
at (2,1), not the predicted (1,1)" — and the memory recorded nothing. The word
"diagonal" first appears in memory at step 105, as a landmark. Room 6 was then
failed with **25 correct predictions out of 25 and no deaths**: ten presses
oscillating `D B D B` between (3,0) and (5,0) on the top corridor, every one
predicted right. A perfect local model and no route. That is a planning
failure, and it says the prediction accuracy number cannot see it.

### Finding 4 — the change

`[measured]` Room 7 went as designed. It took the long route — the pre-change
reference `DDDAAABBBBB` plus one blocked press — and at step 90 pressed B onto
the rings and was sent back. `touched_original_objective: true`,
`staleRuleDeaths: 1`. Then:

- step 91 contradiction: "Button B from (5,1) reset the entity to the room start
  (4,4), rather than moving to (6,1)." The button again. `btn_b` gains the
  condition "may reset the entity from the concentric route".
- `room7` — "…right along y=1 toward the concentric tile at (6,1)" — stays
  **confirmed**. The route that killed it remains the plan of record.
- `room7_radial` is written as "likely with a special relocation effect": the
  **old** radial rule, projected onto the new room.
- Steps 92–94: it walks the short route and presses A onto the radial "to reveal
  its effect", predicting `room_changed: false`. The room ends.

It finished the room the way it finished every room — by trying the other
thing. Nothing in memory says the rings are lethal, and nothing says two things
traded places. `room7_radial` then becomes confirmed, "triggers relocation to a
new room": a correct observation in the agent's own vocabulary.

### Finding 5 — transfer, as a hypothesis it declined to be scored on

`[measured]` Room 8 was solved without touching the rings. At (2,1), with the
rings one press to the right and the radial directly above, it went up:
"Pressing A from (2,1) will move onto the radial tile at (2,0), possibly
triggering a room transition" — `room_changed: null`. `room8_radial` enters
memory as a **hypothesis**. So the room-7 lesson did transfer to new geometry,
and it transferred as a tentative generalisation the agent would not commit to.
That is exactly the R1 limitation the README states: `recovered` measures
revision plus willingness to be scored. This run shows the two coming apart.

### What this does to the metrics

`[derived]` Every post-change telling press, field by field, against both rule
sets:

```
step 90  room 7  B    end_position STALE   returned_to_start STALE   room_changed RIGHT
step 94  room 7  A    end_position RIGHT   returned_to_start RIGHT   room_changed STALE
step 114 room 8  A    end_position RIGHT   returned_to_start RIGHT   room_changed declined
```

**R1 fired at step 90 on a press that was two-thirds stale.** `room_changed:
false` was right under the new rules, but the agent predicted it because it
expected to *stand* on the rings with the room continuing — it has never held
"rings end the room" as a predictive belief (Finding 2).
`firstRevisedPredictionStep` fires on *any* correctly called divergent field, so
an uncommitted belief scored as a revised one, with a detection delay of zero.
The hole is in the criterion, not the log, and the log can be rescored:

| R1 definition | R1 at | recovered at |
|---|---|---|
| any divergent field correct *(pre-registered)* | 90 | 94 |
| every committed divergent field correct | 114 | 114 |
| every divergent field committed and correct | never | never |

`[assumption]` The two alternatives are **post-hoc**, written after seeing the
data, and are reported beside the pre-registered result rather than replacing
it. The middle one is the right pre-registration for the next run: it cannot be
satisfied by a press that was also wrong in exactly the way the dead rule was
wrong. The strictest one punishes honesty and stays a report-only column.

### Two defects in the instrument, found by the run

`[measured]` **The summary cried wolf.** The console summary printed `SEAL
BROKEN — this run is not valid evidence` because `toolUseAlarms` was non-zero,
while the per-step logic had already classified the one item as non-leaky.
Fixed: the summary now says SEAL BROKEN only for a leaky item and otherwise
reports the count with "seal intact", and `summary.json` carries
`seal_broken` explicitly.

`[measured]` **Rooms 6 and 8 do not demonstrate the deflector.** Tracing the
solver's reference solutions through the engine: room 5 carries the entity
once; rooms 6 and 8 carry it **zero times**, under either rule set. In both,
the diagonal is entered heading into a wall, so it deflects into solid and the
entity simply stands on it. `requires: ['/']` is satisfied because the cell is on
the only path — being required as a place to stand, which is precisely the
defect E9 found in room 5's first draft and admitted having no test for. The
README's claims that room 6 exercises "all three mechanics" and that room 8
demands "the revised rule combined with the deflector rule" are false of the
shipped geometry. This run could not have shown it either way, since the agent
never learned the deflector (Finding 3), but the next one deserves rooms that
mean what they say. The check is one line once the rooms are fixed: *the
reference solution of any room that requires `/` must contain at least one
press with `autoMoved > 0`*. Fixing the rooms changes their geometry, which
makes this log unreplayable, which means archiving it under
`runs/archive-engine-v4/` and bumping the engine version. Not done here; it is
the user's call to invalidate the first v4 recording.

### Standing after this run

- **First v4 data exists**, n=1, one subject, one arm. Nothing here is a
  comparison. The stable arm and the flat arm have still never been run.
- The codex subject is a materially different subject from an API model
  (≈11.7k scaffold tokens per call, no system/user split) and its results must
  not be pooled with either without saying so.
- R1 as pre-registered is too weak; the replacement is written down above,
  before the next run.
- The most replicable behavioural finding across three engine versions and two
  models is still "preserve the root, add conditions" — and this run shows the
  root can be the wrong belief entirely.

### Next, in order

1. **Pre-register strict R1** (every committed divergent field correct) and add
   the blame ledger to `computeMetrics`. Both are arithmetic on fields the log
   already records.
2. **Fix rooms 6 and 8** so the deflector carries on the reference route, add
   the `autoMoved` check, bump to engine v5, archive this log. Needs a decision.
3. **Stable arm, same subject, same budget** — the control for rooms 7–8.
4. **Flat arm** — the memory comparison, still never run on any engine.
5. Only then repeats: at ≈1.6M tokens per codex run, an API subject is the
   realistic route to n>1, with the pooling caveat stated.
6. A→B→A return, and E7's echo effect, both still unreproduced on v4.

---

## 2026-09-19 — E18. Two more v4 runs: the budget is a mechanism, and a subject with no model to revise

Two headless campaigns on engine v4, same protocol as E17 except where said.
Both logs are in `runs/` and replay exactly.

| | `codex-v4-b100-2026-09-19T1413` | `gptoss20b-v4-2026-09-19T1333` |
|---|---|---|
| subject | codex exec · gpt-5.6-luna | openrouter.ai · openai/gpt-oss-20b |
| arm | structured / hidden / **budget 100** | structured / hidden / budget 25 |
| rooms solved | 8/8 | 2/8 (rooms 3–7 lost on budget) |
| presses / deaths | 144 / 4 (1 after the change) | 157 / 7 (0 after) |
| per room (presses†deaths) | 8 · 4 · 72†3 · 5 · 9 · 21 · 15†1 · 10 | 8 · 11 · 25†6 · 25 · 25†1 · 25 · 25 · 13 (stopped) |
| field accuracy | 83% (467/565) | 86% (485/556) |
| first evidence / R1 / strict R1 / R2 | 130 / 134 / 144 / 134 | never / — / — / — |
| recovered (loose · strict) | step 134 · step 144 | no |
| transfer | step 144 | no |
| stale rule | 3 predictions, 1 action (fatal) | 0 (nothing to be stale about) |
| invalid replies | 1 (invented status `contradicted`) | 2 (one cut at 8000 tokens, one empty) |
| median / max output tokens per press | 681 / 1258 | 2152 / 5883 |
| seal | intact (one non-leaky `error` item, as in E17) | n/a |

The gpt-oss log is **incomplete**: a network drop ended it at room 8 press 3
(`provider_error` ×3), it was resumed (`run_resume` at 147) and stopped by
hand at press 13 of 25 once the pattern was beyond doubt. Its `summary.json`
predates the resume. Nothing after the change depends on the missing presses:
no discriminating press was ever made.

### The codex run, budget 100

`[measured]` **Recovered and transferred.** Walked the 11-press route to the
rings in room 7, was sent back (130), and on the very next reply demoted
`goal_concentric` in place — *"entering a concentric tile returns the entity
to the room's starting position"* — and set off for the radial. R1 at 134 was
the press onto the radial: `end_position` and `returned_to_start` both called
for the new rule, `room_changed` still predicted false ("may lead onward"). So
it called the surface *safe* before it called it the *goal*; strict R1 (every
committed altered field right, E17's pre-registration for this run) only
lands at 144, entering room 8's radial. Room 8 was ten presses, ten hits,
straight past the rings.

`[measured]` **The budget is part of the exploration mechanism, not just a
cost ceiling.** Room 3 took 72 presses (E17, budget 25: 20). Sixty of them
were a `C D B` shuffle along the bottom row after the second death, thirteen
presses of C predicting "up" and being blocked, the belief never written as
refuted. It got out by testing A in the *other* column, not by avoiding the
radial. Room 6, lost on budget in E17, was solved here in 21 presses with
twenty straight hits. n=1 each way, but the direction is consistent: the
countdown broke the loop in room 3 and lost room 6.

`[measured]` **Memory is goals and routes, not physics.** Final store: four
button claims, `goal_concentric` (suspect), and `room4_route`, `room5_route`,
`room6_route`, `room7_route`, `room8_route`. The radial is named in no claim
after three deaths on it; the deflector surprised it once (s96, predicted
(1,1), landed (2,1), called it "the diagonal tile") and was never recorded.
E17's run *did* write `radial5: relocates the entity to the room start` — the
same subject's memory style varies run to run.

`[measured]` **Attribution follows expectation.** The observation after a
death is the same shape every time: `after` = start, `came_from` = the cell it
was thrown from. In room 3 (s14, s17, s78) it was read as "A moved me
*down*" and the *buttons* were doubted — the reply refused at 18 tried to
mark `btn_a_up` as `contradicted`. In room 7 (s130) the identical shape was
read as "the tile sent me back". The difference was whether it held a
confident belief about the tile: with one, the tile gets the blame; without
one, the button does.

`[measured]` **A refutation filed as support.** After the second death in
room 3, `room3_layout` — "the central column through (2,2) is traversable
toward the concentric tile" — was `confirmed` with `supported_by: [14, 17]`:
the two presses that were sent back from (2,2).

`[derived]` **Revision by elimination.** After room 7 the radial is the only
other marked surface, so "not the rings, therefore the radial" is
indistinguishable in this curriculum from "the two traded places". The
transfer in room 8 is consistent with both. This is the hole E19 is built to
close.

### The gpt-oss-20b run

`[measured]` **No world model reached the change.** Every claim it ever
wrote has a button as its subject; it factors the world as (button × surface)
pairs — `hyp_d_left_radial`, `hyp_a_up_radial`, `hyp_d_left_concentric` — so
a death entered from below taught nothing about a death entered from the
left. Two rooms ended on the rings and it predicted `room_changed: false`
stepping onto them both times. After the change it made zero discriminating
presses in 50: it never touched either surface, so the instrument has nothing
to say about revision for this subject, and that absence is the result.

`[measured]` **A gravity model, held for four deaths.** After the first death
in room 3: *"if D moves onto a radial tile, the entity descends to the lowest
non-solid tile in that column"*. Rooms 3 and 4 cannot refute it — start,
radial and rings share a column, so "sent to the start" and "dropped to the
floor" predict the same cell. It re-tested the drop deliberately three times
(s36, s38, s42), predicting the end position correctly each time, and lost the
room to its own experiments. Room 5 refuted it at s73 (sent to (5,4), gravity
said (4,4)); the claim stayed `hypothesis` with `supported_by: [37]`.

`[measured]` **Told to write shorter, it discarded.** Memory sat at
5900/6000 characters, the s105 update was rejected for size (the harness
rejects rather than trims, and says so), and the next two updates cut 25
entries to 10 and then 3 — every surface claim gone. It entered room 7 with
four button claims. `[assumption]` A 20b model cannot compress a store it
built one claim at a time; the budget interacts with that, and the reject-not-
trim policy is still right, because trimming would have hidden it.

`[measured]` Spurious structure: `confirmed` claims that pressing D onto the
`,` floor "flips the marker to left" — the marker is the direction of travel,
so every such claim is trivially true and explains nothing. The cosmetic
floor variants did exactly what they were planted to do.

### Instrument

`[measured]` **The headless runner capped output at 4000 tokens; the browser
sent no cap (adapter default 8000).** A reasoning model's thinking counts
against `max_tokens`; the first attempt's fourth reply was cut mid-JSON at 244
characters and scored as the subject's malformed reply. Fixed before the
recorded run: the campaign sends no cap either. The doc comment claiming the
two send "exactly" the same thing was false on this one parameter.

`[measured]` `invalid_reply` records now carry `call` (model, latency,
`stop_reason`, usage) in both runners, so a reply the provider cut off
(`length`) is distinguishable from one the subject malformed (`stop`); the
gpt-oss run's two rejections are one of each. `hydrate` counts that usage on
resume and tolerates hand-driven logs, whose presses have no call.

`[derived]` Rooms 3 and 4 cannot separate "returned to start" from "dropped
to the column floor"; room 5 is the first that can. Not a defect — the
curriculum never claimed to teach the start cell — but the gravity story is
now a known attractor for a subject that reasons from one data point.

---

## 2026-09-19 — E19. Engine v5: three rooms and a return, written down before the run

### Why

E18 leaves three things the eight-room curriculum cannot ask:

1. After room 7 the radial is the only other marked surface, so a subject
   that revised "rings end the room" and a subject that merely tried the
   other tile behave identically through room 8. **Rooms 9–11 have to make
   the revised belief do work** — as a plan, and then again in reverse.
2. **A→B→A** has been on the list since E17. If the first revision was an
   idea ("those two can trade places") the second should be cheaper; if it
   was an overwrite, the second costs the same. Only a return can tell.
3. E17 showed rooms 6 and 8 never actually deflect on their reference route.
   A room where the deflector carries, in an orientation not seen before, is
   the transfer test the README always claimed room 8 was.

### The rooms

Rooms 1–8 and the first change are untouched, so every v4 log replays on v5
and stays in `runs/`. `ENGINE_VERSION` is 5 because the curriculum a log was
made on must be legible from its header, and `run_start` now also records
`curriculum: { rooms, interventions_before_levels }`.

| # | room | played | reference (played regime) | the other regime | measures |
|---|---|---|---|---|---|
| 9 | in the way | swapped | 8 `BBAAAADD` | 2 `AA` | the rings sit on the direct climb to the radial; the loop round either side is the only safe route. **A stale-rule death here = the revised belief was not used for planning.** |
| — | *rules swap back* | | | | |
| 10 | the return | original | 7 `DDDAABB` | 13 `BBBAAAADDDDDD` | room 7's contradiction, other way round, different map and button string: the surface it now wants is at the end of the long route and kills; the one it learned to avoid is up a short dead-end and wins. **Delay of the second revision vs the first.** |
| 11 | transfer II | original | 8 `CCCDDDDD` | 3 `CCD` | rings only reachable by being deflected *left* off a descent (room 5 deflected *right* off a climb); the radial one press off the column on the way, three presses in. **Strict transfer of the re-revised rule, plus whether the deflection is predicted.** |

`[measured]` `npm run check`: 79 checks. New ones: every room from 7 on is
dual-regime and the declared list matches; **both** intervention rooms make
the previously learned route fatal and the previously feared route the
shorter answer (the room-7 replay assertions, now run for room 10 with
"before" and "after" traded); `swappedAt` is `oooooo SSS oo`; the deflector
carries at least once on the reference route of every room in
`DEFLECTOR_CARRIES_ON_REFERENCE = [5, 11]` (rooms 6 and 8 are deliberately
not in it — E17's finding stands and is now declared rather than implied);
the runner applies exactly `[7 → swapped, 10 → original]` in every changed
condition and nothing in `stable`.

### Metrics

- **Per-change scoring.** `computeMetrics` now segments presses by the rules
  in force and reports `changes[k]` — evidence, R1, strict R1, R2, recovery,
  transfer, stale counts, deaths — for each scheduled change. The top-level
  fields are `changes[0]`, and the three v4 logs recompute to byte-identical
  numbers (checked field by field against their recorded summaries).
- **Strict R1, pre-registered** (E17's "middle" definition): every altered
  field the agent committed to on a telling press must be right. Rescored on
  v4: E17's run 90 → 114, the b100 run 134 → 144. `recoveredStrict` is the
  headline from this run on; the loose form is kept for comparison.
- **Transfer** is now "a room finished after the change on a later level than
  the one R2 was earned in", which on eight rooms is exactly the old "finished
  room 8 after recovering in 7" and on eleven gives each change its own.
- **Stale-rule action** for the second change is a press onto the surface
  that is lethal under the rules in force — which after a swap back is the
  radial, the surface that ended rooms 7–9. For the first change it is the
  recorded `touched_original_objective`, as before.

### Pre-registered expectations for the first v5 run (codex · gpt-5.6-luna, structured, hidden, budget 100)

`[assumption]` Written before the run; each is falsifiable by one number.

- **Room 9.** The E18 subject left room 8 holding *"entering a concentric
  tile returns the entity to the start"* as `suspect`. If that belief is used
  for planning it takes the 8-press loop with 0 stale-rule deaths. One death
  on the rings at (3,3) falsifies that and says the revision was goal-only.
- **Room 10.** Change-2 detection delay (strict) ≤ change-1's would support
  "an idea"; ≥ would support "an overwrite". Also watched: whether the memory
  write after the first return death names *both* surfaces, or just re-aims.
- **Room 11.** Strict transfer requires predicting the radial at (6,3) as
  lethal (or avoiding it) and the rings as the goal. Separately, the C press
  from (7,3) is the first deflection this subject has been asked to predict
  since room 5; a correct `end_position` (6,4) with no deflector claim in
  memory would mean the mechanic lives in the prompt's reasoning, not the
  store.
- **Budget.** 100 again, so the numbers pool with E18's codex run and not
  with E17's. A second 60-press loop somewhere is expected, not a defect.

---

## 2026-09-19 — E20. The `native` arm: the subject's own conversation as its memory, written down before the run

### Why

Three codex runs (E17, E18, and the v5 run `codex-v5-b100-2026-09-19T1716`,
stopped by hand at room 3 press 39) fail in the same place the same way: in
room 3 every return to the start is booked against a *button* — `btn_a`
"has an exception near the radial tile", `btn_b` "behaved anomalously" — and
no claim about the radial surface is ever written, through five deaths on
one cell entered from two directions. The v5 run adds one detail: its
contradiction flags quote `came_from (2,2)` correctly in the moment; the
error is in what reaches the store.

That leaves two suspects the eight- or eleven-room curriculum cannot
separate: the subject, or the memory protocol — a full rewrite of a
structured list every press, whose only example id is `"btn_b"`. This arm
removes the protocol and keeps everything else.

### The arm

`--strategy=native`, codex provider only. One persisted codex conversation
per run: the first press starts it, every later press resumes it by id
(`codex exec resume <id>`, prompt on stdin). The seal is unchanged except
for `--ephemeral`, which is the flag that forbade exactly this; `resume`
accepts no `--sandbox`/`-C` but keeps the read-only policy and the empty
working root the session began with — checked by hand: a write attempted in
a resumed turn was rejected by the sandbox. The instruction says only "this
conversation persists from turn to turn; there is no separate memory to
write"; the reply carries no `memory` field; the turn carries no memory
block. Observation, the four predicted fields, the contradiction flag and
the echo of the last prediction are byte-identical to the stored arms. The
structured and flat instructions are byte-identical to what every earlier
log recorded (checked against `run_start.system_prompt`).

`[assumption]` What is compared: codex-with-structured-store (three runs)
against codex-with-its-own-context, same subject, same budget, same rooms.
Not comparable with any API arm, and not a "better agent" — any gain is
credited to the absence of the protocol, not to the subject. The subject's
own compaction of a long conversation is part of the condition, not a
confound; when it happens it is visible in `usage` (input tokens and
`cached_input_tokens` per press are recorded, plus `reasoning_tokens`).

### What is measured, and what would settle it

- Room 3 is the test. **If the first surface-attributed contradiction
  appears by the third death, the stored protocol was the cause; if the
  deaths are still booked against buttons past the fifth, the subject is.**
  Read from the `contradiction` field and the hypotheses, since there is no
  store to read.
- Presses to solve rooms 1–3 against 8/27/39+ (v5, stopped), 8/4/72 (E18),
  6/4/20 (E17). Room 2's coordinate trap is the secondary test: with the
  whole history in view, does "the concentric tile is at (3,2)" survive into
  room 2?
- Token growth per press, and whether codex compacts within 40 presses.

First run: rooms 1–3 only (`--rooms=3`), budget 100. The eleven-room run
follows only if room 3 is informative.

### Results, 2026-09-19 — `runs/codex-v5-native-r3-2026-09-19T1821.jsonl`

Rooms 1–3 were run first (`--rooms=3`), then the same conversation was
resumed through room 11 (`run_resume` at step 16; one thread id on every
press). 116 presses, 5.85M tokens (context 12k → 83k per press, ~98%
cached, no compaction observed), seal intact, 0 invalid replies.

```
rooms          11/11     presses 116     deaths 4 (1 acquisition, 3 stale-rule)
per room       4 · 4 · 8†1 · 5 · 9 · 23 · 16†1 · 21†1 · 8 · 7 · 11†1
accuracy       95% (429/451 fields; the only declines were end_position on exit presses)
change 1  (→ swapped, step 54)   evidence 65 · R2 69 · R1 90 = strict R1 · recovered 90 · transfer 90
                                 stale: 7 predictions, 2 actions, 2 deaths (rooms 7 and 8)
change 2  (→ original, step 99)  evidence 105 · R2 105 · R1 116 = strict · recovered 116 · transfer 116
                                 stale: 5 predictions, 1 action, 1 death (room 11)
collateral     -1pp
```

`[measured]` **The pre-registered question is settled at the first death.**
Room 3, press after the first return to the start: contradiction *"Stepping
onto the radial tile reset the entity to the room's starting square instead
of leaving it there"*; next hypothesis *"D moves left around the radial tile
so the entity can approach the exit from the side."* One death, the 6-press
detour, every hypothesis on it naming the hazard. The structured arm needed
five deaths on that cell in each of three runs and never wrote that
sentence. Same subject, same rooms, same budget, same observation: the
memory protocol was the cause, not the model.

`[measured]` Room 2's coordinate trap did not fire (4 presses, reference
path): "the square directly below the concentric tile" was said in passing
and never became a fact to carry.

`[measured]` **Revision 1 was room-local before it was general.** Room 7's
surprise was read correctly in one press — *"The concentric tile returned
the entity to the start, so the remaining objective may involve reaching the
radial"* — and the room was finished on the radial four presses later, but
with the OLD rule in the numbers (predicted "resets to (4,4)"). In room 8 it
walked to the rings again and died again. Only then did the prediction
change: R1 at 90, entering room 8's radial predicting the exit, loose and
strict on the same press. Delay from evidence 25, two stale deaths.

`[measured]` **Room 9 worked as built.** First press: *"D moves left around
the central concentric tile toward the outer corridor"* — the loop, all
eight presses hits, zero stale deaths. The revised rule was a plan in a map
never seen.

`[measured]` **Revision 2 was general and immediate.** Room 10 was finished
by a stale plan (it walked to the rings *to use the reset as a teleport back
to the start* and the room ended instead: evidence and R2 on press 105,
zero deaths). Room 11: one death on the radial lure, and the next reply
flipped both surfaces in one sentence — *"The radial tile reset the entity,
so I will … approach the concentric tile"*. R1 at 116, delay 11, one death,
against 25 and two for the first change. `[derived]` The second swap was
cheaper than the first: by E19's criterion this subject formed the idea
"those two trade places" rather than overwriting a goal.

`[measured]` **The deflector is recognised and never predicted.** Room 5
and room 11 miss identically — predicted the diagonal's own cell, landed one
further — and both times the next flag describes the redirection correctly.
Room 6's diagonal was entered deliberately as a test and its non-deflection
noted (*"did not redirect immediately; it left the entity on the tile"*).
The one mechanic it never models in advance, on either arm.

`[assumption]` What this does and does not show. It shows the structured
store, as specified, costs this subject the attribution it can make
unaided. It does not show a store is bad: a flat text store, or a
structured one with no `btn_b` example, has still not been run, and codex's
own context is not available to an API subject. The native arm is the
control; the flat arm is the next comparison.

This closes volume 1 of the log. Entries continue in `RESEARCH_LOG.md`
from E21.
