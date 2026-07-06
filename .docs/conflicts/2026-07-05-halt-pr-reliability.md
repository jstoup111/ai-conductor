# Conflict Check: Halt-PR presentation reliability

**Date:** 2026-07-05
**New stories:** `.docs/stories/halt-pr-presentation-reliability.md` (D1–D5)
**Scanned against:** all `.docs/stories/`, with focus on `daemon-pr-labels.md` (as-built surfacing +
mergeable sweep) and `finish-should-rewrite-stale-needs-remediation-titl.md` (#271).
**Result:** PASS — zero blocking conflicts. One degrading design-overlap documented with a
coordination resolution (no architecture kickback: designs are reconcilable, no missing seam).

---

## Overlap (degrading): D1 body marker vs #271 stateless / body-clean detection

**Stories involved:** "needs-remediation marker written into the PR body as durable anchor" (D1) vs
`finish-should-rewrite-stale-needs-remediation-titl.md` (#271).
**Type:** state-conflict / design-overlap
**Severity:** degrading (both proceed with a coordination contract)

**Description:**
#271 commits to (a) **stateless, observable-state-only** halt detection via title-prefix + label
(#271 ADR Decision 4), (b) "halt history preserved in **comments, never in the body**", and (c) "no
new persistent **marker/ledger file** … no `.pipeline/`/`.daemon/` marker" — scoped as "by this
feature". D1 introduces `<!-- conductor:needs-remediation -->` in the PR **body** as the durable
enumeration anchor the reconciliation sweep needs (title-prefix fails on a reused ready PR — the
exact #268/#269 blind spot #271's title+label detection cannot see either).

**Why this is reconcilable (not blocking):**
1. The D1 marker is an **invisible HTML comment**, not human-readable halt *history* (the failure
   narrative stays in comments, honoring #271's rule). It carries no state file — #271's "no
   persistent marker/ledger **file**" is about local `.pipeline/`/`.daemon/` files; a remote PR-body
   comment is not a local file.
2. At **finish**, #271 regenerates the PR body to a clean standard body — this **removes** the D1
   marker for free, which is exactly what D5 requires ("finish leaves the PR clean + ready +
   unmarked so the sweep doesn't re-halt it"). The two features are synergistic at finish.
3. Different lifecycle triggers: #271 acts at operator-driven **finish** on a known PR; the D4 sweep
   acts on **un-finished, broken** halt PRs to heal them. They never contend for the same PR at the
   same lifecycle stage.

**Resolution (coordination contract — carried into the plan):**
- The finish body-rewrite (#271) and the D5 marker-strip MUST be the **same** body write, not two
  conflicting writes. If #271 is already implemented, D5's marker removal is satisfied by #271's body
  regeneration (assert the marker is absent post-finish); if not, D5 owns removing the marker as part
  of the same clean-body write.
- D1's marker is documented as an invisible machine anchor, explicitly distinct from #271's
  human-facing halt history — recorded in the ADR so #271's "history in comments" rule is not read
  as forbidding it.

---

## Non-conflicts reasoned through (verify-claims — not assumed clean)

- **D3 (draft-convert on reuse) vs `daemon-pr-labels.md` FR-5 "Reuse an existing PR".** FR-5 asserts
  reuse applies comment+label and skips `pr create`; it is **silent on draft status**. D3 adds a
  draft guarantee on the reuse path — a strengthening extension, no opposing assertion. Confidence
  95%. D3 supersedes/extends FR-5's reuse behavior; no contradiction.
- **D4 (`reconcileHaltPrs`) vs `daemon-pr-labels.md` FR-12 "Never label a needs-remediation PR as
  mergeable".** They act on **different labels** — D4 asserts `needs-remediation` + draft; the
  mergeable sweep manages `mergeable`. FR-12's suppression depends on the label being present; D4
  restores exactly that label, so the two are **convergent**, not contending. The mergeable sweep
  only evaluates PRs in its `.daemon/mergeable-watch.jsonl` watch registry (populated on
  done/success), so it does not even evaluate un-enrolled halt PRs. Sequencing note (→ plan): run
  `reconcileHaltPrs` before the mergeable sweep in the startup/tick order so the label is present
  when mergeable evaluates; even out of order it converges next tick. Non-blocking.
- **D2 (`ensureHaltPresentation`) vs `daemon-pr-labels.md` surfacing/comment stories.** D2 wraps the
  existing best-effort primitives with verify-after-write; the existing failure-reason **comment**
  (`upsertComment`) path is unchanged and retained. No overlap on the comment marker.

## Marker written
`.pipeline/review-required-conflict_check` written (degrading conflict documented).
