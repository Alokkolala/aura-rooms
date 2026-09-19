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
