# Intake origin: decide-the-daemon-engine-rename-before-the-v1-0-ta

Source-Ref: jstoup111/ai-conductor#227
Owner: jstoup111

## Desired outcome

- The daemon→engine / engineer→brain vocabulary question is resolved by a recorded, approved decision: either (a) rename in the 1.0 major, or (b) explicit re-defer — it stops being an open question.
- If (a) rename: the scope is enumerated (subcommands, config keys, docs, `.daemon/` paths) and the work is bound to the same major as cutover PR #226.
- If (b) re-defer: the decision record states why and what would reopen it, so the v1.0 tag can be cut without this blocking.
- The decision lands before the v1.0 tag is cut and closes #227.

## Operator amendment — PR #1921 review, 2026-08-26

- The landed spec must build the selected rename, not create a later documentation/scoping-only feature.
- `player` and `composer` become the canonical CLI and supported-host skill names while the old
  `daemon` and `engineer` command names remain temporary, warning compatibility aliases.
- Existing Player configuration and durable runtime state survive the rename through deterministic
  legacy-key normalization and `.daemon/` state resolution; ambiguous state must not be overwritten.
- Ordinary documentation updates are upkeep attached to the owning functional change, never stories
  or standalone BUILD-plan tasks.
