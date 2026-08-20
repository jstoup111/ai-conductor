# Complexity: Live-boundary guard cannot attribute a live-checkout change

Tier: M

## Rationale

**Signals present**

- **Multi-module surface (5+).** A new `self-host/live-containment.ts` (bind-set derivation,
  wrapper construction, capability probe), the single wrap seam in `conductor.ts`
  (`prepareCandidateSelfHost`, both the Codex and Claude branches),
  `self-host/live-boundary.ts` (containment-aware halt reason), `resolved-config.ts` /
  `config.yml` (an escape hatch to disable containment), plus
  `docs/guides/running-the-daemon.md`, `docs/runbooks/stalled-or-stuck-feature.md`, and
  `CLAUDE.md`'s Daemon Operations Safety section, whose "unsafe while a build runs" list is
  the reader-facing statement of the behavior being changed.
- **External process boundary.** `bwrap` is an OS binary, not a Node dependency. Its
  presence, its exit codes, and its failure modes have to be probed and handled, and the
  probe has to prove the *derived bind set* is correct — not merely that the binary exists.
- **Provider-neutral by requirement.** The containment must apply to both the Claude
  (sandboxed) and Codex (provider-home-only) branches, which today have materially different
  provisioning paths. Getting one and not the other reproduces the bug for the other
  provider.
- **Fail-closed semantics change under load.** The guard's halt decision now consumes a
  containment verdict. Every path through that verdict — contained, uncontained, probe
  failed, containment disabled — has to keep fail-closed behavior and name its evidence, and
  those paths are what the regression coverage in outcome 6 is about.
- **Blast radius is the whole self-host lane.** A wrong bind set does not fail a test — it
  makes every self-host dispatch fail with `EROFS` mid-build. Conflict-check earns its place:
  self-host provisioning is actively touched by other in-flight work.

**Signals absent**

- No data models, no persistence schema, no migrations.
- No auth surface, no network surface, no third-party service calls.
- No state machine; bind-set derivation and the probe are pure/bounded functions over a path
  list.
- Estimated 5–7 stories — short of Large.

**Not S** — an S tier skips conflict-check and architecture entirely. Both are load-bearing
here: the change adds an OS-level dependency to the dispatch path and alters the semantics of
an existing fail-closed guard, and it lands into a lane other features are concurrently
editing.

**Not L** — the surface is one new module plus one call seam. There is no new subsystem, no
schema, and no cross-phase coordination; the work is bounded by the existing
`prepareCandidateSelfHost` contract, which already returns exactly the
`{ executable, args, env }` triple the wrapper needs to rewrite.
