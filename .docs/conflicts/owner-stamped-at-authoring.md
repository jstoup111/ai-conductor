# Conflict check: owner-stamped-at-authoring

**Stem:** `owner-stamped-at-authoring` · **Issue:** #721 · **Tier:** M

## Method

Cross-referenced this spec's touched surfaces against (a) the freshly-merged #695
`intake-only-enforcement` spec (PR #719), (b) the owner-gate's own shipped ADRs, and
(c) the #720 remediation. Checked for file-set overlap and decision-level contradiction.

## Reconciliation with #695 (`intake-only-enforcement`, PR #719) — NO COLLISION

The two specs share the word "intake" but operate on **different artifacts, different files,
and different lifecycle points**:

| Axis | #695 (intake-only-enforcement) | This spec (owner-stamped-at-authoring) |
|------|--------------------------------|----------------------------------------|
| Artifact | GitHub **issue** criteria (`priority:`/`size:`/linking labels) | Spec **artifact** `Owner:` marker in `.docs/intake/<slug>.md` |
| Capture surface | `.github/ISSUE_TEMPLATE/intake.yml`, `intake-label-sync.yml`, `bin/intake-file`, `bin/intake-backfill`, `backlog-priority.ts` | `writeIntakeMarker` (`intake-marker.ts`), `authoring.ts`, `owner-gate/gate.ts`, `daemon-backlog.ts` |
| Read/consume | `dependency-claim.ts` / `github-issues.ts poll()` (asserted **unchanged**) | `decideSpecGate` / `daemon-backlog.ts discoverBacklog` |
| `skills/intake/SKILL.md` | Rewrites §7/§8 filing to route through `bin/intake-file` | **Not touched** (owner stamping is deterministic machinery, not skill prose) |

- **File-set overlap:** none. #695's touched files and this spec's are disjoint. In
  particular, this spec does **not** touch `skills/intake/SKILL.md`, `intake.yml`,
  `backlog-priority.ts`, `dependency-claim.ts`, or `github-issues.ts`; #695 does not touch
  `intake-marker.ts`, the `owner-gate/` module, or `daemon-backlog.ts`'s owner gate.
- **The one shared string** — both mention `.docs/intake/` — refers to **different files**:
  #695's marker for its own spec (`.docs/intake/intake-only-enforcement.md`) vs this spec's
  (`.docs/intake/owner-stamped-at-authoring.md`). No same-file edit.
- **Decision compatibility (reinforcing, not contradictory):** #695 established "requirements
  satisfied at capture time; NO new downstream failure mode." This spec deliberately adopts
  the **same shape** for the Owner marker — born owned at authoring, and a read-time default
  (never a rejection). The two are complementary applications of one principle, not competing
  designs.

## Reconciliation with the owner-gate ADRs — CONTAINED CHANGE

- `adr-2026-06-30-owner-provenance-recording` (Owner recorded on the intake marker; parser is
  exactly `Owner:`): **unchanged** — this spec keeps the marker format and the `provenance.ts`
  parser byte-identical; it only guarantees the field is populated at the write path.
- `adr-2026-06-30-owner-gate-identity-resolution` / `adr-2026-07-01-machine-scoped-operator-identity`
  (resolution chain: `spec_owner` → `gh` → unresolved; project config never in the identity
  path): **unchanged and reused** — `authoring.ts`'s fallback uses exactly `readMachineOwnerConfig`,
  the sanctioned machine-scoped path.
- The gate's original decision matrix (`gate.ts` header) is **amended, deliberately and in this
  ADR**: `unowned-post-cutover` / `unowned-indeterminate` transition from skip to
  default-build (`unowned-defaulted`). This is the one intentional decision reversal, recorded
  in `adr-2026-07-21-owner-stamped-at-authoring.md`. `other-owner`, `grandfathered`, and
  stamped-and-matching are preserved — no contradiction with the isolation guarantee those
  ADRs protect.

## Reconciliation with #720 (repo-local integrity check) — RETAINED, DEMOTED

The `.docs/intake/*.md` Owner check in `test/test_harness_integrity.sh` is **kept** (fast local
belt for this repo). This spec adds the runtime layers and updates the docs so the check is no
longer described as the enforcement. No conflict — the check and the runtime guarantee are
additive; the check simply stops being load-bearing.

## Verdict

No blocking conflict. One intentional, ADR-recorded gate-decision amendment (un-owned →
default-build). Disjoint file set from #695. Isolation-critical decisions (`other-owner`,
stamped-match, identity resolution, marker format) are preserved byte-identical.
