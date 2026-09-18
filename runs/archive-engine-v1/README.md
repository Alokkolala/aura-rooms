# Recordings from engine v1 — NOT replayable

These three runs were recorded before the engine was rebuilt. They are kept
because `RESEARCH_LOG.md` E5 and E7 make claims about them, and deleting the
evidence for a published claim is not an option.

They cannot be loaded in the replay viewer. Under v1 the buttons were
turn-relative (turn left / forward / turn right / back), the diagonal surface
rotated the entity in place rather than deflecting its travel, and the rooms had
different shapes. Room 7 was 9x7; it is now 9x4, so a recorded position like
(0,6) is outside the current grid and replay does not merely disagree — it
crashes.

They are in this folder rather than `runs/` precisely so the viewer does not
list them and cannot try.

| file | what it was |
|---|---|
| `smoke-cold-*` | first cold-start probe, room 1, 2 presses |
| `probe3-*` | room 7 after the change, author-seeded memory, no prediction echo — the run where the broken rule stayed `confirmed` through three falsified predictions |
| `probe4-echofix-*` | the same moment with the agent's own prediction echoed back — the run where it demoted the rule to `suspect` |

The finding these support (E7) therefore describes **engine v1** and has not been
reproduced on v2. That is a real gap, not a formality: v2 changed the control
scheme, so it is not safe to assume the same behaviour carries over.
