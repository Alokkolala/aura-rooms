# Recordings from engine v3 — NOT replayable

Engine v3 had the same mechanics as v4 — four absolute-direction buttons, a
deflector, and a rule change that swaps the concentric and radial surfaces — but
a different curriculum. v4 rebuilt all eight rooms so that each one introduces
exactly one thing, with rooms 1 and 2 containing no lethal surface at all. Every
room these logs refer to has different geometry now, so replaying them against
the current engine diverges on the second or third press.

They also predate the v4 response schema. A v3 step recorded a single
`predicted_position`; a v4 step records four separate observable claims in
`expect`, and every metric — the recovery criterion above all — is computed from
those. Nothing here can be rescored under the current definitions.

Kept because RESEARCH_LOG makes claims about them.

| file | what it was |
|---|---|
| `v3run-*` | The run E14 describes. Hand-stepped through `scripts/smoke.ts` with a sealed Haiku subagent, 14 presses, room 1 (old geometry) not solved. Logged as `condition: stable`, and stable is what it was — see the correction in E16. |
| `structured-hidden-manual-*` | Earlier hand-driven probes. Despite the file names these were `stable` runs in practice: the smoke stepper's `maybeIntervene` was nested inside another function and never called, so no hand-driven run ever applied the swap. Fixed in v4; see E16. |
