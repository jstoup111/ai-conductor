# Complexity: Unhalt after main advance resumes against stale feature base

Tier: M

## Rationale

**Medium.** The change is confined to the daemon's resume path and reuses tested primitives,
but it is not a local edit: it introduces a capability the codebase does not have today and
sits on a concurrency-sensitive seam.

Signals weighed (the same set `conduct` uses):

- **New models / schemas** — none. No new persisted format is required; the decision is
  computed from git refs at resume time.
- **Integrations** — none external. Git only, through the existing injected `GitRunner`.
- **Auth** — none.
- **State machine** — yes, and this is the dominant signal. The change alters the ordering
  contract between HALT-clear, park, the one-shot `.pipeline/REKICK` sentinel, the
  rebase-first play-forward, and the verdict-aware resume clamp. Four existing park/HALT
  race guards must keep holding.
- **Story count** — an estimated 6-8 stories: base-advance detection, the resume-time
  decision, the unchanged-base no-op path, seal rebaseline via the audited route, the
  upstream-equivalent-commit regression proof, park precedence, and observability.
- **Blast radius** — the resume path is shared by every halted feature in the fleet, so a
  regression is fleet-wide rather than feature-local. That rules out Small.

Not Large: no new subsystem, no schema migration, no cross-repo contract change, and the
rebase, seal-rebaseline, and gate-invalidation machinery it depends on all exist and are
already covered by acceptance tests.

## Tier consequences

Non-Small, so this spec carries the full DECIDE artifact set: architecture diagram,
architecture review with ADRs, conflict-check, and the coherence-check traceability mapping.
