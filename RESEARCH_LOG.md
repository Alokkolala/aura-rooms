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
seeded. `tool_uses: 0` on all eight spawns. Log: `runs/live-cold-*.jsonl`.

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
