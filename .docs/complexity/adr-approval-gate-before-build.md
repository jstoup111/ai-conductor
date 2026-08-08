# Complexity: ADR approval enforced before build

Tier: M

## Rationale

Medium — matches the `size: M` label on jstoup111/ai-conductor#662.

Signals present:
- Touches **three** enforcement rungs across two subsystems (engineer `land`, daemon backlog
  discovery) plus a retained third (as-built review), so the change is wider than a single seam.
- Introduces a new shared contract (`adrApprovalStatus()`) that three call sites must agree on —
  a divergent reading is the exact bug being fixed, so the seam itself is load-bearing.
- Replaces an existing exported function (`hasDraftAdr`) with different semantics, requiring
  migration of both current call sites and their tests.
- Carries a corpus migration (3 legacy `Proposed` ADRs stamped `APPROVED`) that must land in the
  same change or the gate blocks every land.
- Parser must tolerate a genuinely varied real-world grammar (4+ status-line forms observed
  across 238 files), so the test matrix is non-trivial.

Signals absent (why not Large):
- No data models, no migrations, no auth, no external integrations, no state machines.
- No new step, no new phase, no config schema change, no CLI surface change.
- Purely additive to existing gate structure — the daemon-backlog check mirrors the adjacent
  `stories-not-approved` block almost line for line.

Consequence: `/architecture-diagram`, `/architecture-review`, `/conflict-check`, and
`/coherence-check` all run (none are skipped — skipping applies to tier S only).
