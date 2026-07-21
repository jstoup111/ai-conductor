# Complexity: spec-authoring-is-blind-to-unmerged-dependent-work (#523, Scope A)

Tier: M

## Signal assessment

| Signal | Reading | Tier |
|--------|---------|------|
| Data models / persistence | **None.** The scan is read-only and stateless — no marker written, no authoring-base recorded (that is Scope B, explicitly out). Emits an advisory report to the author only. | S |
| Integrations | git (new: enumerate unmerged `spec/*` + open-PR branches, `git diff --name-only` via the existing `rebase.ts#changedPathsBetween`), `gh` (reuse `blocker-resolver.resolve()` over the native `blocked_by` API). Two integrations, both with existing primitives to reuse. | M |
| Auth / identity | None. | S |
| State machine | None. A few behavioral branches (overlap found / clean / resolver-indeterminate / branch-enumeration-failed) but no persistent FSM. | S |
| Concurrency | None introduced. Point-in-time snapshot at authoring. | S |
| Story count | ~6–7: overlap detected + named (happy), open blocker surfaced (happy), no links + no overlap = zero ceremony (negative/quiet path), resolver indeterminate degrades gracefully, branch-enumeration failure degrades to advisory-skip (never blocks authoring), overlap intersect is file-accurate (no false match on unrelated paths). | M |
| Correctness risk | Medium. Advisory (never blocks build), so a miss is a soft failure — but a false negative silently reintroduces the exact insider-knowledge gap #523 targets, and false-positive noise erodes author trust. The overlap intersection and branch enumeration must be accurate. | M |

## Verdict

**Tier: M (Medium).** Not Small: it adds the first branch-enumeration-and-diff machinery in
the engine, integrates two subsystems (git + gh), and has several correctness-sensitive
behavioral branches with ~7 stories. Not Large: no new data models, no persistence, no new
architecture, no auth, no concurrency; the build side (`daemon-backlog`) is byte-for-byte
untouched, and it reuses existing resolver + diff primitives rather than introducing new
subsystems.

## DECIDE consequences (Medium)

- PRD: **skipped** (technical track).
- architecture-diagram: **included** (component/flow diagram of the scan: inputs = candidate
  Files + Source-Ref; sources = unmerged branches + blocker API; output = advisory report).
- architecture-review: **lightweight**, with one APPROVED ADR recording the hook-point
  decision (`/architecture-review` + `/plan`) and the advisory-not-blocking stance.
- conflict-check: **included**.
- stories + plan: **required**.
