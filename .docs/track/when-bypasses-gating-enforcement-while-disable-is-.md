# Track: when: bypasses gating enforcement while disable: is gated on configDisableAllowed

Track: technical

Scope boundary: Align `when:` authority with `disable:` — config-load rejection of `when:` on structural steps and on gating steps without `configDisableAllowed`, plus rendering the `when_skip` event. No runtime guard, no broader gating-policy rework.

Engine config-validation hardening with no user-facing product surface; acceptance criteria live in stories.
