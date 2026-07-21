# Intake origin: owner-stamped-at-authoring

Source-Ref: jstoup111/ai-conductor#721
Owner: jstoup111

Routed to `ai-conductor`. Spec authored under the operator directive:

> **The Owner marker guarantee must be harness-native machinery, not repo-local.**
> ANY deployment of the harness must guarantee a spec is owned — the repo's own
> `test/test_harness_integrity.sh` (PR #720) never runs in consumer projects.

Two properties, mirroring the #695 "born complete at capture, no new downstream
failure mode" pattern:

- **Born owned:** every conduct-ts path that writes `.docs/intake/<slug>.md`
  stamps `Owner:` deterministically from machine identity at creation time.
- **No silent dead spec:** an artifact that still arrives un-owned is
  default-attributed to the daemon's own owner and **built with a loud, actionable
  escalation** — never the current silent-forever-skip, and never a merge-time or
  dispatch-time rejection.

Composes with (does not collide with) the #695 intake-only-enforcement spec
(PR #719), which enforces GitHub-issue *criteria* (priority/size/linking); this
spec enforces the spec-artifact *Owner* marker. See
`.docs/conflicts/owner-stamped-at-authoring.md` and
`.docs/decisions/adr-2026-07-21-owner-stamped-at-authoring.md`.
