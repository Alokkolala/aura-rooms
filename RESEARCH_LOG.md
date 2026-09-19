# AURA Rooms — research log, volume 2

Volume 1 (`RESEARCH_LOG_E0-E20.md`, 2026-09-18 → 2026-09-19) built the
instrument three times over and ends with the run that showed the memory
protocol, not the subject, was what failed in room 3. This volume starts
from that instrument. Entries continue the numbering: the first one here is
E21. Same conventions: append-only, newest at the bottom, every claim tagged
`[measured]` (came out of a run or a check), `[derived]` (arithmetic or
reading over recorded data) or `[assumption]` (design choice, expectation,
or a reading that has not been checked). Corrections to an entry are added
as a dated note under it, never by rewriting it. Record what did not work.

## The instrument as it stands (2026-09-19, engine v5, commit after E20)

**World.** Eleven rooms (`src/engine/levels.ts`), four absolute-direction
buttons, two marked surfaces that look like siblings: rings end the room,
spokes send the entity back to the start. A deflector turns travel 90°
clockwise and carries one cell. The surfaces silently trade meanings before
room 7 and trade back before room 10 (`INTERVENTIONS_BEFORE_LEVELS = [7, 10]`).
Reference lengths: 4 · 4 · 6 · 5 · 9 · 19 · 4 · 10 · 8 · 7 · 8 in the regime
each room is played under. `npm run check` runs 80 checks, including: every
`requires` claim (ban the surface, the room must become unsolvable), no two
rooms share a solution, rooms 1–2 hazard-free, both intervention rooms
contradictory both ways, rooms 7–11 solvable under both regimes, the
deflector carrying on the reference route of rooms 5 and 11 (rooms 6 and 8
are on record as not demonstrating it), and every log in `runs/` replaying
exactly.

**Observation.** Only what a person watching the screen would see: the grid
as anonymous tile names, the entity's position and marker, the last press as
`before → after` with `came_from`, whether the room changed, the previous
room's outcome on a room's first turn, the budget. Never a cause. Forty-eight
forbidden word-starts are audited on every observation and on every arm's
prompt.

**Reply.** One button; a hypothesis; a prediction in words; four checkable
fields (`end_position`, `position_changed`, `returned_to_start`,
`room_changed`, each nullable = declining); a contradiction flag; and, on
the stored arms, the whole memory rewritten.

**Arms.** Memory: `structured` (list of `id/claim/conditions/status/…`
entries, 6000-char budget, rejected not trimmed when over), `flat` (one text
block, same budget), `native` (no store; codex keeps its own conversation —
one persisted session per run, resumed by id, sealed except for
`--ephemeral`; codex provider only). Condition: `stable` (no change),
`hidden` (both swaps, nothing said), `notified` (a content-free notice on
the first turn of each intervention room). Budget per room is part of the
protocol (25 declared; 100 used for the codex runs of E18–E20).

**Subjects.** Sealed codex (`--sandbox read-only`, empty working root,
`--ignore-user-config --ignore-rules`; every press records `tool_uses` and
item types, any command/file/search item marks the run non-evidence) and
any OpenAI-compatible or Anthropic API model. Codex arms and API arms are
never pooled: codex carries ~11–16k tokens of its own scaffolding per call
and has no system/user split.

**Metrics** (`src/metrics.ts`, arithmetic over recorded positions only).
Per scheduled change (`changes[k]`, top-level = the first): first evidence
(first press whose outcome differs between the two rule sets), R1 (a
correct prediction on an altered field of such a press), strict R1 (every
committed altered field right — the headline from v5 on), R2 (a room
finished after the change), recovered = R1 ∧ R2, transfer (a later room
finished after R2's), stale-rule predictions/actions/deaths, detection
delay. Plus field accuracy, collateral accuracy on unaltered fields, and,
on the structured arm, belief-status tracks and demotions.

## Standing results carried in from volume 1

| run | arm | rooms | presses | deaths | change 1 recovered (strict) | change 2 |
|---|---|---|---|---|---|---|
| E17 `codex-v4-…T1208` | structured, b25, 8 rooms | 7/8 | 114 | 10 | 94 (114) | — |
| E18 `codex-v4-b100-…T1413` | structured, b100, 8 rooms | 8/8 | 144 | 4 | 134 (144) | — |
| E18 `gptoss20b-v4-…T1333` | structured, b25, 8 rooms | 2/8 | 157 | 7 | never (no evidence seen) | — |
| E19/20 `codex-v5-b100-…T1716` | structured, b100, 11 rooms | 2/11 (stopped, room 3) | 70 | 5 | — | — |
| E20 `codex-v5-native-r3-…T1821` | **native**, b100, 11 rooms | **11/11** | 116 | 4 | **90 (90)** | **116 (116)** |

- `[measured]` With its own conversation, codex attributes a return-to-start
  to the tile after one death; with the structured store it never does, in
  three runs (E17, E18, E20).
- `[measured]` Native, change 1: revision was room-local first (a second
  stale death in room 8), then general. Change 2: general after one death.
  The second swap was cheaper than the first.
- `[measured]` gpt-oss-20b (structured) never touched a marked surface after
  the change; the instrument has nothing to say about revision for it.
- `[measured]` The deflector is recognised after the fact and never
  predicted, on every arm and subject so far.
- `[measured]` Budget 25 vs 100 on the same subject and room: 20 vs 72
  presses in room 3, and room 6 lost vs solved. The countdown is part of the
  exploration mechanism. n = 1 each.

## Open, in order

1. **Flat arm on codex, eleven rooms, budget 100.** If a text store also
   fixes room 3, the culprit is the structured schema specifically; if not,
   it is having to rewrite a store at all.
2. **Structured arm with a neutral example id** (the instruction's only
   example is `"btn_b"`): does removing the prime change what gets written?
3. **Stable arm** (control) and **notified arm**, both never run on v5.
4. An API subject on the eleven rooms (Sonnet 5 / Opus 5), reported
   separately from codex.
5. Record codex's reasoning items alongside the reply (`summariseCodexEvents`
   currently keeps the final message only).
6. A room that forces the deflection to be *predicted* to avoid a hazard.

---

## 2026-09-20 — E21. Three native conditions, written down before the runs

E20 gave one native run under `hidden`, budget 100. Three more, each a
different condition rather than a repeat, so the first result gets its
controls instead of its variance:

| tag | condition | budget | question |
|---|---|---|---|
| `codex-v5-native-stable` | stable | 100 | the control. Same rooms, nothing swapped. Post-change metrics must be null; rooms 7–11 solved under the original rules; presses per room set the baseline the changed arms are read against. |
| `codex-v5-native-notified` | notified | 100 | detection vs relearning. A content-free notice on the first turn of rooms 7 and 10. If delay after evidence shrinks against E20's 25 / 11, noticing was part of the cost; if not, the cost is relearning. |
| `codex-v5-native-b25` | hidden | 25 | the declared protocol budget. E18 found the countdown drives exploration on the structured arm (room 3: 20 vs 72 presses). Does native, which never looped, care? |

`[assumption]` Expectations, one number each: stable — no stale-rule
deaths anywhere, rooms 7–11 within four presses of reference; notified —
change-1 stale deaths ≤ 1 (E20: 2); b25 — every room finished under budget,
since E20's longest room was 23 presses.

Same subject, same seal, same eleven rooms, one persisted conversation per
run. Comparable with E20 only.

> **Note, 2026-09-20.** The three runs were started and stopped by hand within
> minutes (the stable run reached 8 presses before the processes were killed;
> the other two had barely begun). Nothing from them is kept in `runs/`; E21
> stands as the plan, unexecuted.

---

## 2026-09-20 — E22. Four parameter variants of the native `hidden` run, written down before the runs

E21's plan was replaced before it ran: the condition stays `hidden`, and
what varies is a parameter of the experiment, so that each run answers a
question E20 could not. Same subject (codex · gpt-5.6-luna), same seal, one
persisted conversation per run, same eleven rooms. Two instrument knobs were
added for this and are recorded in every log's `run_start`:
`AURA_INTERVENTIONS` moves the scheduled changes (refused unless every room
from the first change on is finishable under both regimes and no hazard-free
room is played swapped), and `AURA_OBS_ABLATE=came_from` withholds the
waypoint field from the observation. The checks in `scripts/` run against
the default schedule; a variant log is replayed by the engine like any other
but its prompts are only reproducible under its own environment.

| tag | change | budget | question | expectation `[assumption]` |
|---|---|---|---|---|
| `codex-v5-native-early` | changes before rooms **4 and 10** (rooms 4–9 swapped) | 100 | entrenchment: the first swap after three rooms of experience instead of six. Room 4 becomes the intervention room — a forced choice between the two doors. | fewer stale deaths for change 1 than E20's two: a rule held for one room is cheaper to drop than one held for four |
| `codex-v5-native-three` | changes before rooms **4, 7 and 10** (swapped 4–6, original 7–9, swapped 10–11) | 100 | does the cost of revision keep falling with each change? (E20: 2 deaths, then 1) | third change: 0 or 1 stale deaths, and the flip written after the first surprise |
| `codex-v5-native-nocf` | `came_from` **withheld**; default schedule | 100 | what the attribution in E20 rested on. `observation.ts` says the experiment is unwinnable without it. | at least one extra death in room 3, and a button-attributed first reading of the return; whether it still recovers is the open question |
| `codex-v5-native-b25` | budget **25** (the declared protocol) | 25 | does native, which never looped, feel the countdown? | every room finished under budget (E20's longest room was 23 presses) |

Rooms 4–6 under the swapped rules have reference routes of 5, 2 and 20
presses; room 5's radial is two presses from the start, so a subject that
has just learned "radial resets" in room 3 meets its first contradiction in
the room after. Comparable with E20 only; the `early` and `three` runs have
no room 7 as first contradiction and are not comparable with each other on
change-1 numbers, only on the trend across changes within a run.

### Results, 2026-09-20

All four ran to completion, one conversation each, seal intact, one
rejected reply in total (B, step 38, malformed JSON, no press spent).

| run | rooms | presses | deaths | change 1: evidence · strict R1 · stale deaths · delay | change 2 | change 3 |
|---|---|---|---|---|---|---|
| E20 (baseline) | 11/11 | 116 | 4 | 65 · 90 · 2 · 25 | 105 · 116 · 1 · 11 | — |
| A `early` [4,10] | 11/11 | 118 | 4 | 25 · 30 · 1 · 5 | 99 · 107 · 2 · 8 | — |
| B `three` [4,7,10] | 11/11 | 177 | 10 | 21 · never · 3 · — | 68 · 79 · 6 · 11 | 174 · never · 0 · — |
| C `nocf` | 11/11 | 142 | 4 | 69 · 106 · 2 · 37 | 127 · 134 · 1 · 7 | — |
| D `b25` | 10/11 | 106 | 3 | 66 · never · 2 · — | 98 · 106 · 0 · 8 | — |

`[measured]` **A, confirmed.** The first swap after three rooms of experience
cost one death and a delay of 5 (E20: two and 25); rooms 5–9 had no death
at all. The entrenchment moved to the other change: two deaths on the
return, the second of them in room 11 one press after writing that the
radial resets.

`[measured]` **B, refuted, and the most informative failure of the series.**
Three swaps did not teach "these two trade places"; from the second
contradiction on the subject explained every return with a mechanism —
the `,` floor tiles as switches that must be "activated" before the exit
works. Room 8: four deaths on the same spokes, one cell from the rings, with
"the next bottom-row switch position" pressed six times in a row between
them; solved at press 69 of the room with "the radial has been activated
and the switches traversed". Change 3 cost nothing because the routine
"radial first" happens to be the swapped-rules route; strict R1 never for
changes 1 and 3. After the second swap it began declining
`returned_to_start` and `room_changed` on presses onto marked surfaces,
which is why the console scored deaths as hits.

`[measured]` **C, refuted in room 3, partly confirmed after the swap.**
Without `came_from` the first death was read exactly as with it ("Go around
the radial tile … from the reset position"), one death, same 8 presses. The
difference came after change 1: the return from the rings was read as a
property of the approach ("from the left"), followed by a "collect the
marked tiles" detour; strict R1 only after the second death (delay 37 vs
25). Both changes recovered, 11/11.

`[measured]` **D, refuted on budget and revealing on commitment.** Room 6
lost at 25 presses (reference 19; E20 took 23). After change 1 the subject
finished rooms 7–9 by walking onto the radial while leaving
`returned_to_start` and `room_changed` empty on every such press, and kept
committing `room_changed: true` on the rings — two deaths, including one on
the direct climb in room 9. Action revised, prediction not: R2 without R1
for change 1, which is exactly the case the criterion was built to
separate.

`[derived]` Across five runs: room 3 costs one death in every condition,
with the surface named in the next reply every time; the first revision
after a swap is room-local before it is general (E20, C, and A on the
return); a second contradiction on the same surfaces reliably produces
either the swap idea (E20, A, C) or a false mechanism (B, C briefly), and
what decides between them is not visible in n=1. The E20 claim that
attribution rested on `came_from` is withdrawn: it rests on the subject
having named the tile in its own hypothesis before stepping on it.

Written up in `paper/AURA_v2_documentation.docx` (sections 3.6, 3.7, 4.1–4.3).
