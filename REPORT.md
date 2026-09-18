# AURA Rooms — what was built, and how the agent actually did

A plain-language account. `README.md` is the manual, `RESEARCH_LOG.md` is the
dated lab notebook. This is the story.

---

## 1. The question

When an AI agent learns how something works and then that thing quietly changes,
what happens to what it already knows?

The easy failure is obvious: it keeps acting on the old rule. The interesting
question is narrower. When the agent finally notices something is wrong, **what
does it throw away?** Ideally it should find the one belief that broke, fix that,
drop the plans that were built on top of it, and keep everything else. The two
bad outcomes are throwing away everything (and re-learning the world from
scratch) or throwing away the wrong thing (and keeping the broken belief).

AURA Rooms is a small world built to watch exactly that moment happen, on
purpose, under controlled conditions.

---

## 2. What was built

A little grid game the agent plays blind.

The agent sees a room as a grid of shapes, and it has four buttons: **A, B, C,
D**. Nobody tells it what the buttons do. Nobody tells it what the different
floor patterns do. Nobody even tells it what makes a room end. It has to work
all of that out by pressing buttons and watching.

Each turn it must do four things:

1. say what it's trying to find out,
2. **predict what it thinks will happen**,
3. press one button,
4. write down whatever it wants to remember.

Then it sees the result. Its memory is the only thing that survives to the next
turn — it never sees its own earlier messages. That last detail matters a lot: it
means "what the agent knows" is exactly "what's in its memory file," which is
what makes comparing memory styles meaningful at all.

There are eight rooms. After room six, **one rule silently changes** and nobody
tells the agent.

### The real rules (the agent never sees these)

| What it looks like | What it actually does |
|---|---|
| Two plain floor patterns | Nothing. They look different and behave identically — a deliberate red herring |
| Solid block | Blocks movement |
| Striped floor | **Carries you** along the way you were moving until you hit a non-striped tile or an obstacle |
| Diagonal floor | **Deflects** your movement 90° clockwise and carries you one more cell |
| Concentric rings | Ends the room if you finish a move on it |

**The hidden change:** the striped floor stops carrying you. It looks exactly the
same. It just becomes ordinary floor.

That's the whole experiment. Everything else is scaffolding to watch it cleanly.

### Two ways of remembering

The point of the project is comparing these:

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

---

## 3. How the agent actually performed

Here's the part you probably want. Three runs, narrated.

There was no API key available, so I couldn't run the app's automated agent.
Instead I drove the exact same protocol by hand, one press at a time, using a
sealed Haiku model with **no tools at all** — no file access, no search. That
seal matters: an agent that could read the source code would just look up the
rules and the whole exercise would be theatre. Every single call reported zero
tool uses, and I checked its first answer for any knowledge it couldn't have had.
It was clean.

### Run 1 — starting from nothing

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

### Run 2 — the change, without help

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

### Run 3 — the same moment, one change

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

It's one run per condition. It could be luck. It has to be repeated before anyone
believes it. But if it holds, it says something uncomfortable and useful:

> A big chunk of what looks like *"the agent failed to notice the world changed"*
> may actually be *"the setup never showed the agent what it had predicted."*

That matters beyond a prompt tweak. "How fast does the agent notice?" was
supposed to be a measurement about the agent. It turns out to be partly a
measurement of the harness. And worse — remembering your own prediction is
exactly the kind of bookkeeping that a structured memory makes easy and a flat
text blob makes hard. So the two memory styles would have been separated by a
filing artifact that has nothing to do with belief revision at all.

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

**And an error I made during the live run itself.** At one step I typed part of
the prompt by hand instead of copying the harness output, and got one field
wrong. The agent dutifully reported a contradiction — about my typo. That step is
marked as contaminated in the log. It's also a perfect illustration of the
reviewer's point: a hand-driven process with no saved prompts can't be audited.
The app now saves the exact prompt for every step.

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
- The world is built, deterministic, and verified. 32 automated checks.
- All eight rooms are proven solvable, and proven *unsolvable* without the
  mechanics they claim to teach.
- The two intervention rooms work under both rule sets, with the change costing
  6–7 extra moves, so a stale belief actually hurts.
- A real agent, starting from nothing, discovers the controls, forms theories,
  labels its own uncertainty, corrects itself, and builds plans on top of
  beliefs.
- The instrument can produce *both* clean revision and total failure to revise,
  on demand.

**Cannot say:**
- **Nothing about which memory style is better.** Every model run so far used
  structured memory. There is no flat-memory run. There is no comparison. This is
  the project's headline question and it is currently untested.
- Nothing statistical. One run per condition.
- No agent has yet reached the rule change using knowledge it learned itself —
  the adaptation runs used memory I wrote.

---

## 7. What to do next, in order

1. **One full run through all eight rooms from empty memory**, reaching the
   change through genuinely earned knowledge. Everything else is guessing until
   this exists.
2. **The same run with flat memory.** Then, for the first time, there's a
   comparison.
3. **Repeat the prediction-echo result properly.** It's currently the most
   interesting finding and the least supported.
4. **Add a return to the old rule (A → B → A).** It's the cheapest way to tell
   real revision apart from simply forgetting fast — a memory that only keeps
   recent things looks brilliant at adapting and hopeless at returning.
5. **Then** make attribution ambiguous. Right now a single contradiction points
   at exactly one culprit, which may make careful revision and crude
   "retest whatever broke" the same thing. That's the biggest open threat to the
   whole idea.

---

## 8. One-line summary

A small world where an AI learns rules by poking at them, and one rule is changed
behind its back — plus the finding that whether it notices depends partly on
something that seemed like a formatting detail: whether you bother to remind it
what it predicted.
