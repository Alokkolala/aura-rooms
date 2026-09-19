# AURA Rooms — what was built, and how the agent actually did

A plain-language account. `README.md` is the manual, `RESEARCH_LOG.md` is the
dated lab notebook. This is the story.

---

## 1. The question

> **Can an autonomous agent discover the rules of an unknown world, use them
> across levels, detect when a previously reliable rule silently changes, and
> revise its world model efficiently?**

That is four questions wearing one coat, and the point of the rebuild was to
stop them being tangled together:

1. **Acquisition.** Can it work out the rules at all, from nothing?
2. **Transfer.** Does a rule learned in one room survive into the next one, with
   different geometry?
3. **Detection.** When a rule it relied on silently stops being true, how long
   does it take to notice — counted from the first moment the world actually
   showed it something, not from the moment the researcher flipped the switch?
4. **Revision.** When it finally notices, **what does it throw away?** Ideally it
   finds the one belief that broke, fixes that, drops the plans built on top of
   it, and keeps everything else. The two bad outcomes are throwing away
   everything and re-learning the world from scratch, or throwing away the wrong
   thing and keeping the broken belief.

Earlier versions of this project described themselves as being about *flat vs
structured memory*. That is now a **sub-experiment**: it asks which way of
storing beliefs revises better, and it presupposes there are beliefs to store.
Rooms 1–6 exist to watch them being formed.

AURA Rooms is a small world built to watch all four things happen, on purpose,
under controlled conditions.

---

## 2. What was built

A little grid game the agent plays blind.

The agent sees a room as a grid of shapes, and it has four buttons: **A, B, C,
D**. Nobody tells it what the buttons do. Nobody tells it what the different
floor patterns do. Nobody even tells it what makes a room end. The entire
instruction is the mechanics of a turn plus one line: *"Explore the environment
and progress as far as you can."*

Each turn it must do four things:

1. say what it's trying to find out,
2. **commit, in advance, to four specific things it expects to see**,
3. press one button,
4. write down whatever it wants to remember.

Then it sees the result. Its memory is the only thing that survives to the next
turn — it never sees its own earlier messages. That last detail matters a lot: it
means "what the agent knows" is exactly "what's in its memory file," which is
what makes comparing memory styles meaningful at all.

There are eight rooms. After room six, **one rule silently changes** and nobody
tells the agent.

### The eight rooms, and why they are in that order

The curriculum *is* the experiment. If two mechanics arrive in the same room
there is no way to tell afterwards which one the agent was learning.

| # | room | what it is for |
|---|---|---|
| 1 | controls | Learn the four buttons. **There is no lethal surface in this room at all** — you cannot lose a life while working out which way is up. |
| 2 | the same shape | Confirm that what ended room 1 was the *surface*, not the square. Room 1's winning cell (3,2) is ordinary floor here, sitting directly beneath the real one, on a route exactly as short as the way around. Still no lethal surface. |
| 3 | the straight line | Introduce the lethal surface where it cannot be missed: it sits exactly halfway between the start and the exit, so "press the same button until something happens" walks onto it on the second press. |
| 4 | two doors | Transfer, as a forced choice. Two identical corridors, one surface at the end of each, equidistant. Every solution commits to a belief, so this room yields a measurement whatever the agent does. |
| 5 | reorientation | Introduce the deflector, load-bearing: the exit is behind it and unreachable otherwise. |
| 6 | assembly | Everything at once. Nothing new. This is the room that says whether the first five stuck. |
| — | **the swap** | Silent. Nothing is said in the hidden arm; one sentence in the announced one. |
| 7 | the same two | Maximum contradiction. The long route the agent spent six rooms learning to prefer is now fatal; the short route it learned to fear is now the answer, four presses from the start. |
| 8 | transfer | New geometry. The revised rule has to be combined with the deflector rule that never changed. |

A test asserts every one of those claims that can be asserted: that rooms 1 and 2
contain no fatal press from any pose, that the hazard appears first in room 3 and
the deflector first in room 5, that no two rooms are finished by the same button
sequence, and — for room 7 — that replaying the pre-change solution under the new
rules is fatal *and* the post-change solution is fatal under the old ones.

That last test is the one that matters most. Without it, room 7 could drift into
being merely confusing rather than contradictory, and a null result there would
mean nothing.

### The real rules (the agent never sees these)

| What it looks like | What it actually does |
|---|---|
| Two plain floor patterns | Nothing. They look different and behave identically — a deliberate red herring |
| Solid block | Blocks movement |
| Diagonal floor | **Deflects** your movement 90° clockwise and carries you one more cell |
| Concentric rings | **Ends the room** if you finish a move on it |
| Radial spokes | **Kills you** and sends you back to the room's start |

The last two are drawn as a matched pair — same palette, same size, both centred
and symmetrical. Nothing about how they look says which is which.

**The hidden change: the two swap meanings.** The rings become lethal, the spokes
become the exit. Neither changes appearance. An agent carrying the old rule walks
onto what it believes is the way out and dies.

That change is deliberately harsher than the one it replaced. An earlier version
switched off a "sliding floor" mechanic, which cost the agent *moves* — it still
won, just slower. Costing it the room instead makes stale knowledge fatal rather
than merely expensive, and gives a careful agent a reason to probe instead of
striding onto the thing it is sure about.

That's the whole experiment. Everything else is scaffolding to watch it cleanly.

### What the agent has to predict, and why it isn't an event label

Before every press the agent commits to four things, each of which a person
watching the screen could check:

- `end_position` — the square it will be standing on when everything settles
- `position_changed` — whether it will be anywhere other than where it is
- `returned_to_start` — whether it will be on the square this room began on
- `room_changed` — whether the next turn will be in a different room

Any of them can be `null`, meaning "I'm not saying". A null is recorded as
declining and is **never** counted wrong. Everything else is compared with `===`,
so "was the agent right" is arithmetic. No language model ever judges another
language model's prose anywhere in this project.

The obvious alternative was one event label — *move / blocked / deflected /
death / room_complete*. It reads better and it is wrong twice over.

**It leaks.** Those words are in the system prompt from turn one. An agent
standing in room 1, which contains nothing that can hurt it, would have been told
that *dying* and *being deflected* are things this world does — two rooms before
the first and four before the second. The whole point of the curriculum is that
each idea arrives exactly once, when a room introduces it.

**And it forces a false choice.** A press can be deflected *onto* the exit. A
single label needs an arbitrary precedence rule, and the agent would then be
scored partly on guessing a labelling convention instead of on understanding the
world. Four independent yes/nos compose freely.

`returned_to_start` is what being sent back *looks like*. `room_changed` is what
finishing *looks like*. The agent is free to write "I think that tile kills you"
in its free-text field; nothing scores it.

### Two ways of remembering

The sub-experiment:

- **Flat memory** — one block of free text. Rewrite it however you like.
- **Structured memory** — a list of separate beliefs, each with an ID, the claim,
  when it applies, a status (*hypothesis / confirmed / suspect / superseded*),
  which steps supported it, which steps contradicted it, and **which other
  beliefs it was built on top of**.

The idea being tested is that the second one should make it easier to fix one
broken belief without disturbing the rest. That's a hypothesis, not a fact, and
it has not been tested yet — see §6.

Both get the same model, the same information, the same budget, the same size
limit, and — importantly — the same explicit permission to correct anything they
previously wrote. A rigged comparison would be worthless.

### What counts as having recovered

This is the definition, fixed before any run. The agent has recovered when
**both** have happened after the change:

- **R1** — it makes a **correct prediction about something the change actually
  altered**. Not any correct prediction: the engine resolves every press twice,
  once under each rule set, and records exactly which of the four fields read
  differently. R1 requires a correct call on one of *those*.
- **R2** — it **finishes a room** after the change.

**The old definition was three correct predictions in a row, and it was broken.**
Three presses down an empty corridor look identical before and after the swap. An
agent that had revised nothing at all could satisfy it by being able to count
squares, and the instrument would report a recovery. There is now a test named
`ORDINARY MOVEMENT ACCURACY CANNOT TRIGGER RECOVERY` that feeds ten consecutive
correct ordinary predictions *plus* a finished room and asserts the agent is
still not recorded as recovered.

R2 is in there because a prediction is cheap and a room is not. An agent can be
right about a surface and never act on it.

**Reaching room 8 is reported next to recovery, not folded into it.** It is a
much harder bar, and folding it in would make `recovered` false for nearly every
run in every arm — a number that is always zero separates nothing.

Alongside that, the run records: how long detection took *measured from the first
press that could possibly have revealed the change* (measuring from the flip
punishes the agent for time it had no way to use), how many presses were wrong in
exactly the way the dead rule would have been wrong, how many times it walked
onto the surface that used to be the exit and how many of those cost it the room,
and how much accuracy it lost on the rules that did **not** change — which is the
only collateral-damage measure that works for a flat store, since free text has
no statuses to demote.

---

## 3. How the agent actually performed

> **Everything in §3 and §3b happened on earlier versions of this instrument.**
> They are kept because they are what motivated the rebuild — each of the four
> defects fixed in v4 was found by watching a real agent hit it — but none of
> their numbers can be rescored: a v3 step recorded a single
> `predicted_position` where a v4 step records four separate claims, and every
> current metric is computed from the latter. The recordings are in
> `runs/archive-engine-v1/`, `-v2/` and `-v3/`. **The first run on the current
> instrument is §3c.**

Here's the part you probably want. Three runs, narrated.

There was no API key available, so I couldn't run the app's automated agent.
Instead I drove the exact same protocol by hand, one press at a time, using a
sealed Haiku model with **no tools at all** — no file access, no search. That
seal matters: an agent that could read the source code would just look up the
rules and the whole exercise would be theatre. Every single call reported zero
tool uses, and I checked its first answer for any knowledge it couldn't have had.
It was clean.

**Important caveat, and I got this wrong in the first version of this report.**
These three runs are *not* three parts of one story. Run 1 was played on the
current game. Runs 2 and 3 were played on an **earlier version** — before an
external review prompted a rebuild that changed the controls from turn-relative
to four absolute directions, redefined the diagonal surface, and reshaped all
eight rooms. The room 7 that runs 2 and 3 took place in no longer exists; it was
9 cells tall and is now 4. Their recordings will not even load in the replay
viewer, and they are kept in `runs/archive-engine-v1/` for that reason.

So: **run 1 covers room 1 only**, on the current engine. Runs 2 and 3 describe a
game that has since been rebuilt, and their finding has not been reproduced
since. Presenting them as one continuous set was sloppy of me.

### Run 1 — starting from nothing (room 1 only, current engine)

Empty memory, room 1, every button chosen by the model. It finished the room in
8 presses; the theoretical best is 4. The four "wasted" presses weren't waste —
they were it figuring out the controls.

| Press | What it did | Why | What happened |
|---|---|---|---|
| 1 | A | "does A move me?" | moved up one |
| 2 | B | deliberately tried an untested button | moved **right** — it had guessed left, and said so |
| 3 | C | testing a pattern it had spotted | moved down, exactly as predicted |
| 4 | D | "completing the cardinal direction pattern" | moved left |
| 5–8 | A ×4 | executing its plan | **room complete** |

Four things it did that were genuinely good, none of which it was told to do:

**It fixed its own mistake quietly.** On press 1 it wrote down that the target
was at position (0,0). On press 2 it rewrote that to (2,0), which is correct.
Nobody pointed out the error.

**It formed a real theory from two examples.** After seeing only A and B, it
wrote:

> *"Buttons correspond to cardinal directions: A=up, B=right, C=down(?),
> D=left(?)"* — status: **hypothesis**

Those question marks are its own. It marked the two parts it had actually tested
as confirmed, generalised to a rule, and explicitly flagged the half it was
guessing. Then it spent its next two presses testing exactly that guess.

**It upgraded the belief on evidence, not vibes.** Once D confirmed the pattern,
it promoted the rule to **confirmed** and listed the specific steps that
supported it.

**It built a plan on top of the rule, and said so.** It wrote a `path_to_goal`
entry that explicitly recorded it was *built on* the direction rule. That's the
structure the whole experiment is about — a belief, and things standing on top of
that belief. It produced it unprompted.

### Run 2 — the change, without help *(old engine, room 7, seeded memory)*

Now the interesting one. I gave the agent a memory that already contained the
correct rules (marked clearly as author-written, not learned) and dropped it into
room 7, *after* the striped floor had stopped working.

It made a plan: *"go up, turn right, press B once and slide all the way to the
goal."* Then:

| Press | It predicted | What actually happened |
|---|---|---|
| 6 | carried across the room, **room ends** | moved one cell |
| 7 | carried across the room, **room ends** | moved one cell |
| 8 | carried across the room, **room ends** | moved one cell |

Three specific, confident, completely wrong predictions in a row.

And it never flagged a contradiction. Not once. The broken rule stayed marked
**confirmed** with zero recorded contradictions.

What it *did* do is the fascinating part. It deleted the **plans** that were
built on the broken rule, and kept the broken rule itself. That is precisely
backwards: the thing that was wrong survived, and the innocent things built on it
got thrown out.

### Run 3 — the same moment, one change *(old engine, room 7, seeded memory)*

Then I found a flaw in my own setup. **The agent was being asked to report
contradictions while never being shown its own prediction.** It saw what
happened, but not what it had said would happen. It could only compare the two if
it had manually copied its prediction into memory first.

So I changed one thing: the prompt now hands the agent its own previous
prediction back. Same model, same memory, same room, same position — one
difference.

| | Without its prediction (3 tries) | With its prediction |
|---|---|---|
| Reported a contradiction? | never | yes, in detail |
| Status of the broken rule | stayed **confirmed** | changed to **suspect** |
| Recorded contradictions | none | logged, then accumulated a second |
| The 6 unrelated rules | — | untouched, all still confirmed |
| Plans built on the broken rule | deleted, rule kept | dropped, **rule demoted** |

That's the behaviour the project was built to look for: find the broken belief,
demote it, drop what stood on it, leave everything else alone. Zero false
alarms on the rules that hadn't changed.

It then did something better still. It proposed a *replacement* theory — "maybe
the carry only happens when you **start** on a striped tile, not when you enter
one" — tested it by pressing from a striped tile, watched that fail too, recorded
the second contradiction, and concluded the carry simply doesn't work here. Its
next prediction was correct for the first time since the change.

**Two steps from "something is wrong" to a working model of the new world.**

### What this does and doesn't prove

It's one run per condition, on a version of the game that no longer exists. It
could be luck. It has to be repeated on the current engine before anyone believes
it. But if it holds, it says something uncomfortable and useful:

> A big chunk of what looks like *"the agent failed to notice the world changed"*
> may actually be *"the setup never showed the agent what it had predicted."*

That matters beyond a prompt tweak. "How fast does the agent notice?" was
supposed to be a measurement about the agent. It turns out to be partly a
measurement of the harness. And worse — remembering your own prediction is
exactly the kind of bookkeeping that a structured memory makes easy and a flat
text blob makes hard. So the two memory styles would have been separated by a
filing artifact that has nothing to do with belief revision at all.

---

## 3b. What happened when the world got lethal

The rebuilt world was run cold, empty memory, every press model-chosen. It got
**14 presses into room 1 and did not solve it.** Three deaths. That failure is
the most useful thing in this report.

It learned the controls well, and — unlike the earlier run — it **abandoned a
wrong theory instead of defending it**. It briefly believed the buttons were
turn-relative, demoted its own claim to *suspect*, then rewrote all four
correctly. It even logged an error against its own bookkeeping rather than
blaming the world.

Then it lost the room to the exact failure this project studies. Having
established that the spoked tile killed it, it would not accept the simple rule.
Three deaths on the same cell, each followed by a narrower condition rather than
a retraction:

| after death | what it wrote |
|---|---|
| 1st | "radial tile at (2,2) kills entity" — correct |
| 2nd | "kills **when the marker is up**" — narrowed; tested another marker, died |
| 3rd | "safe if the **marker matches the movement direction**" — tested it, died |
| — | *"previous hypothesis of marker-match safety was false... appears unconditionally deadly"* |

Right answer on the fourth attempt. Then it spent its remaining presses testing a
*fourth* variant instead of finishing, and ran out of budget.

**This is the same behaviour as the earlier run, on a completely different
mechanic.** Before, it defended a turn-relative button model with "B rotates
until it finds an open path". Here it defended conditional lethality with "safe
if the marker matches". Two rebuilds of the world, two unrelated rule families,
the same shape every time: **keep the root claim, bolt conditions onto it.**

That makes it the most replicable thing the project has found, and it points at
the model rather than the world.

## 3c. The first real run on this engine

*(2026-09-19. Full detail in `RESEARCH_LOG.md` E17; the log is
`runs/codex-v4-2026-09-19T1208.jsonl` and replays exactly.)*

One subject — OpenAI's `codex` CLI driving `gpt-5.6-luna`, sealed so it could not
read anything but the prompt — played all eight rooms from empty memory, hidden
condition, 25 presses a room. 114 presses, zero malformed replies, zero tool
uses. Halfway through, one call hung past the five-minute limit and the runner
died; the run was resumed from the log, which the protocol makes exact (the
subject never had any history to lose), and the resume is now a tested feature.

**The scoreboard says it worked.** Seven of eight rooms. It reached the change on
knowledge it had earned itself, walked the long route it had learned to prefer
straight onto the rings — now lethal — and was sent back, exactly as room 7 is
built to make happen. Four presses later it finished that room by the short
route, and then finished room 8, new geometry, without ever touching the rings.
By the criterion fixed before the run: **recovered at step 94, transferred at
114.**

**The transcript says something else, and it's the more interesting result.**

It died ten times in the campaign, and after every single death its stated
contradiction blamed a *button* — "Button A moved the entity from (2,3) to (2,4),
contradicting the earlier assumption that A always moves upward" — never the
tile it had just stepped on, even though the observation named that cell every
time. Its button beliefs were correct throughout; it spent the run demoting them
anyway. Nine of the twelve contradictions it ever filed against a button were
deaths. The first belief about the lethal tile appears after the ninth death,
and only for that one room.

So when the swap came, there was no rule to revise. After the death on the rings
it blamed button B again, kept "toward the concentric tile" as the confirmed
plan, and finished the room by trying the only tile it hadn't tried — predicting
the room would *not* end. Room 8 it solved by carrying that observation forward
as a hypothesis, "possibly triggering a room transition", and declining to commit
to it. Nothing in its final memory says the rings are lethal, or that two things
traded places.

Two other things the run showed:

- **A solved room is not a learned rule.** Room 2 was solved optimally on a
  press it predicted wrong. Across 114 presses it committed to a room ending
  exactly once. It reaches exits; it doesn't predict them.
- **Room 6 fell with a perfect model.** 25 correct predictions out of 25, no
  deaths, and it never got near the rings — ten presses were spent stepping
  left and right along the same corridor. Prediction accuracy cannot see a
  planning failure.

And two things it showed about the instrument. The recovery criterion fired on
a press that was wrong in exactly the old rule's way on two of three fields and
right on the third — the "any field" rule is too loose, and the stricter version
is now written down for the next run. And rooms 6 and 8, traced through the
solver, never actually carry the entity on the deflector; the diagonal is
required only as a square to stand on, the same defect §4 describes catching in
room 5. Fixing that changes the rooms and archives this log; it is queued, not
done.

What this is: one trajectory, one subject, one arm. What it is not: a
comparison of anything with anything.

---

## 4. Things that broke, including my own mistakes

This is the honest part. Most of what I learned came from things being wrong.

**A level that taught nothing.** I designed room 6 to require riding the striped
floor and getting deflected. The solver's answer was to walk straight up an open
column, touching neither. I'd never have caught it by playing — I'd have played
the route I already had in mind.

**Then I shipped the same bug again.** An external reviewer found room 8 had the
identical flaw. I'd fixed room 6 *by hand* and never turned the fix into a check.
Now it's a check: every room declares which surfaces it requires, and the test
suite bans each one and re-solves. If the room is still solvable, the test fails.
"Solvable" is the weak question. **"Solvable only the intended way"** is the one
with teeth.

**The agent never saw the result of its winning press.** This was the worst one,
and it attacked the entire premise. When the agent finished a room, the code
loaded the next room and wiped the record of the press that won — so the agent
was being asked to figure out what ends a room while being denied the one
observation that shows it. And running out of time also moved it to a new room,
so from the inside, winning and failing looked identical. Fixed: it now sees the
closing press, where it landed, and whether it won or timed out.

**The log was lying about what the agent knew.** The memory update was applied
before the log line was written, so every recorded step claimed the agent had
seen the memory it had just written. The log couldn't answer the one question it
exists for. Now there are three separate fields: what it saw, what it proposed,
what was accepted.

**One of my tests was certifying a bug as correct.** A test asserted that the
record of the winning press *should* be wiped. Thirty-two green checks were
guaranteeing broken behaviour.

**A fairness bug between the two memory styles.** Formatting overhead made the
structured memory take about 2.3× more characters than its actual content. At an
equal character limit, the structured side would have carried far less knowledge
— purely because of whitespace. That's not a finding about memory, that's a bug
in my ruler.

**I let two runs become unreplayable and did not notice.** Rebuilding the rooms
silently invalidated the two recordings that support the most interesting finding
in this project. Worse, the replay viewer did not report a mismatch — it crashed,
because a position recorded in the old 9x7 room 7 is off the edge of the new 9x4
one, while the README was still telling people they could load those logs and
check them. Now: every run records the engine version, the viewer reports an
incompatible recording instead of dying, incompatible logs live in
`runs/archive-engine-v1/`, and a test asserts that everything still in `runs/`
replays exactly. That test found 58 further stale logs on the first run.

**The same withholding bug, a third time.** On the rebuilt world the agent died
and concluded *"entity dies when returning to the starting position"*. It never
connected the death to the tile — it couldn't, because after a death the reported
"after" position is the respawn point, so the lethal cell appeared nowhere it
could see. Third instance of the same class, after the winning press and the
agent's own prediction. Every one was invisible to the test suite and only
surfaced when a real agent reasoned from what it was actually handed. Tests check
that code does what it says; they cannot check that what it says is enough to
reason from.

**And an error I made during the live run itself.** At one step I typed part of
the prompt by hand instead of copying the harness output, and got one field
wrong. The agent dutifully reported a contradiction — about my typo. That step is
marked as contaminated in the log. It's also a perfect illustration of the
reviewer's point: a hand-driven process with no saved prompts can't be audited.
The app now saves the exact prompt for every step.

### 4b. What the v4 rebuild found

Four more, and the first two are worse than anything above because they were
silently corrupting the experiment rather than crashing it.

**Every arm was warned that the rules might change.** The system prompt ended
with *"the rules of this world are usually stable, but they are not guaranteed to
stay that way."* That sentence lived in the block common to **all three
conditions**. So the *hidden* arm — whose entire definition is that it is not
warned — was warned. The *stable* arm was warned about something that never
happens to it. And the *announced* arm's single sentence, which was supposed to
be the only thing distinguishing it, was no longer distinguishing anything. The
project's central comparison had been quietly collapsed, in one sentence, from
the very first run. It is gone, and a test now asserts that the word *"rule"*
does not appear anywhere in what a hidden-arm agent is sent.

**No hand-driven run ever applied the rule change.** `scripts/smoke.ts` had its
`maybeIntervene` function declared *inside* another function — one stray brace —
so nothing could reach it. Every hand-stepped run in this repository's history
was effectively a `stable` run, whatever its filename said, including all the
ones named `structured-hidden-manual-*`. Nothing caught it because `scripts/` was
never typechecked. It is now, and an unused-symbol check found it on the first
pass. (It didn't change any published finding — no hand-driven run ever reached
room 7 — but it would have, the first time one did.)

**The recovery metric could be satisfied by walking in a straight line.** Covered
in §2: three correct predictions in a row, of anything, counted as having
recovered from a rule change. This is the one I'd most want someone else to check
my fix on, because it's the kind of defect that produces *publishable-looking
numbers* rather than an obvious crash.

**Two rooms had the same answer.** Rooms 1 and 2 were both finished by `AABB`.
Room 2's whole job is to confirm that the *surface* ends a room rather than the
square or the sequence — and an agent could have satisfied it by replaying four
button presses. Caught by writing the assertion, not by playing. There is now a
test that no two rooms share a solution.

The pattern across all four, and across §4's list too: **tests check that the
code does what it says. They cannot check that what it says is the right thing to
say.** Every one of these was found by writing down a claim the project was
implicitly making and then asking whether anything enforced it.

---

## 5. One design change worth explaining

The buttons originally meant *turn left / go forward / turn right / go backward*.
Two problems: "turn left then go backward" and "turn right then go forward" land
you in the same place, so the agent could succeed while holding a wrong-but-
consistent idea of turning. And working out the scheme ate most of a room's
budget.

Now the four buttons are just four directions. The agent learns all four in about
four presses — as the live run showed — and the budget goes where it belongs: on
the floor rules, because a floor rule is what the experiment actually changes.

---

## 6. What we can honestly claim right now

**Can say:**
- The world is built, deterministic, and verified. **77 automated checks**, plus
  typechecking on the app, the scripts and the server.
- All eight rooms are proven solvable, proven *unsolvable* without the mechanics
  they claim to teach, and proven not to share a solution with each other.
- Rooms 1 and 2 are proven to contain no fatal press from any pose, and proven
  to be unreachable by the swap — so the "no hazard while learning the controls"
  claim cannot be broken by a later edit to which glyph kills.
- Room 7 is proven contradictory in the strong sense: the pre-change solution is
  fatal after the change, and the post-change solution is fatal before it.
- Rooms 7 and 8 are proven finishable **through the runner**, in all three
  conditions, within budget — not just solvable on paper.
- The recovery criterion is proven immune to ordinary movement accuracy.
- The hidden arm is proven to receive no hint that anything can change.
- A real agent, starting from nothing, discovers the controls, forms theories,
  labels its own uncertainty, corrects itself, and builds plans on top of
  beliefs.
- **One sealed agent has played the whole v4 campaign from empty memory**,
  reached the change on its own knowledge, died on the stale rule, and finished
  both rooms after it (§3c). The pipeline survives eight rooms end to end with
  zero malformed replies, and a run can be resumed exactly after a provider
  failure.
- On that run, every death was attributed to a button rather than the surface,
  and the recovery scored by the pre-registered criterion is not a revision the
  memory contains. Both the pre-registered and a stricter scoring are reported.

**Cannot say:**
- **Nothing about which memory style is better.** Every model run so far used
  structured memory. There is no flat-memory run. There is no comparison.
- Nothing about the change versus the rooms. The stable arm — the control — has
  never been run.
- Nothing statistical. n=1 on v4, and a codex subject is not an API subject.
- Nothing about the deflector as a mechanic. The one v4 subject never learned
  it, and rooms 6 and 8 turn out not to demonstrate it anyway.

---

## 7. What to do next, in order

1. **Tighten the recovery criterion before the next run**: R1 = every
   committed divergent field correct, so a press that is stale on two fields and
   right on one cannot count. Add the blame ledger — for each button belief, the
   share of its `contradicted_by` presses that were deaths — so misattribution
   becomes a number rather than a paragraph. Both are arithmetic on fields the
   log already has.
2. **Fix rooms 6 and 8 so the deflector actually carries** on the reference
   route, and add the check that it does. This changes their geometry, so the
   first v4 log gets archived and the engine version bumps. A decision, not a
   patch.
3. **The stable arm, same subject, same budget.** It is the control for the
   whole curriculum: without it, a collapse in rooms 7–8 cannot be separated
   from those two rooms simply being harder than the six before them.
4. **The same run with flat memory.** Then, for the first time, there's a
   comparison — and it is a sub-experiment, not the headline.
5. **Repeats.** A codex run costs ~1.6M tokens; an API subject over OpenRouter
   is the realistic route to n>1, with the pooling caveat stated every time.
6. **Repeat the prediction-echo result properly.** It's still the most
   interesting finding and the least supported, and it has never been reproduced
   on the current engine.
7. **Add a return to the old rule (A → B → A).** It's the cheapest way to tell
   real revision apart from simply forgetting fast — a memory that only keeps
   recent things looks brilliant at adapting and hopeless at returning.
8. **Then** make attribution ambiguous. Right now a single contradiction points
   at exactly one culprit, which may make careful revision and crude
   "retest whatever broke" the same thing. That's the biggest open threat to the
   whole idea — though §3c suggests an unambiguous culprit does not stop an
   agent blaming something else.

---

## 8. One-line summary

A small world where an agent has to work out the rules from nothing across six
rooms, then has one of them changed behind its back — built so that "did it
notice, and what did it break fixing it" is arithmetic rather than an opinion,
and rebuilt once the old version turned out to be warning every arm about the
change and calling three steps down a corridor a recovery.
