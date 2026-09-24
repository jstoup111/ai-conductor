# Complexity: Preserve project-owned PR body sections through finish

Tier: M

The change spans five existing areas — the SHIP draft body seed, finish region capture/restore/verify before the ready flip, config-load validation of template markers against declared custom steps, halt-PR and body-floor recognition of a template-seeded draft, and deletion of the self-host `Release-*` snapshot with the `release-disposition` skill migrated onto the generic mechanism — and needs one new decision on pull request body ownership. It adds no new subsystem, integration, authentication boundary, or state machine; the finish publication coordinator's transition order is unchanged. Confirmed Medium by the operator on 2026-09-24.
