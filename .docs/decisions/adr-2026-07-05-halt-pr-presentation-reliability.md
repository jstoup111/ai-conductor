# ADR 2026-07-05: Halt-PR presentation reliability — verify-after-write + reconciliation

**Date:** 2026-07-05
**Status:** APPROVED
**Deciders:** James (operator, selected Approach A) + harness architecture-review
**Feature:** Halt PRs must reliably carry needs-remediation label + draft status
**Source:** ai-conductor#274 (instances #268/#269 broken, #267 correct; rate-limit episode #270)
**Track:** technical · **Tier:** Medium
**Architecture review:** `.docs/decisions/architecture-review-2026-07-05-halt-pr-reliability.md`
**Sequence:** `.docs/architecture/sequences/halt-pr-reliability.md`

## Context

A halt PR that reaches GitHub without its `needs-remediation` label and draft status is
indistinguishable from a ready feature PR: GitHub reports it `MERGEABLE`, and merge-order sweeps or
operators can mistake an un-remediated halt PR for mergeable work. **Mergeable-but-remediation-
required must not present as mergeable.**

Current behavior (verified in code):
- `escalateBuildFailure()` (`build-failure-escalation.ts:73`) opens the halt PR via
  `findOrCreatePr()` then `addLabel()` + `upsertComment()`. Every gh primitive in `pr-labels.ts` is
  best-effort — it **swallows errors and logs**, with **no verify-after-write and no retry**.
- **Reuse gap:** when `findOrCreatePr` (`pr-labels.ts:341`) finds an existing OPEN PR it returns it
  without asserting draft or label. A pre-existing *ready* feature PR is reused as the halt PR and
  stays ready + unlabeled — the likely cause of #268/#269 (non-draft, zero labels).
- No reconciliation re-asserts halt-PR state. The only startup/tick sweep (`sweepMergeableLabels`,
  `mergeable-sweep.ts:118`) manages the `mergeable` label on *done* PRs and only *suppresses*
  mergeable when `needs-remediation` is already present — so if the label is what is missing, that
  safety net cannot fire.
- The `conductor:needs-remediation` marker (`pr-labels.ts:418`) lives on a **comment**, decoupled
  from halt detection (title-prefix + label).
- No gh-specific rate-limit/retry exists; the #270 rate-limit handling is LLM-provider-only.

## Decision

Adopt **Approach A — verify-after-write + reconciliation sweep** (operator-selected). Five specific
decisions:

### D1 — Durable enumeration anchor: the `needs-remediation` marker moves into the PR **body**
The reconciliation sweep needs a signal that identifies a halt PR *even when the label and draft
are missing*. Title-prefix (`needs-remediation:`) is insufficient: a reused ready PR keeps its
original feature-PR title. Therefore escalation writes `<!-- conductor:needs-remediation -->` into
the PR **body/description** (idempotently — never duplicated on reuse), and the sweep enumerates
open PRs by that body marker. The existing same-named **comment** marker is retained for the
human-facing failure reason (unchanged).
- *Basis:* verified — `gh pr list --json body,isDraft,labels,state,url,number` exposes all needed
  fields (confirmed via `gh pr list --json`). Confidence 97%.

### D2 — A single idempotent `ensureHaltPresentation(prUrl)` helper in the `pr-labels.ts` seam
One convergent, idempotent operation asserts the full desired halt-PR presentation: (a) body carries
the marker, (b) PR is draft, (c) `needs-remediation` label present — each written via the existing
REST/`gh` primitives, then **re-read to confirm** and retried bounded (small fixed attempt count
with backoff) on mismatch. It is safe to call from both escalation and the sweep because it only
asserts desired state. On retry exhaustion it returns a non-fatal "unconfirmed" result and leaves
the PR for the reconciliation sweep — it never throws (preserves the best-effort contract of the
seam). Label add stays REST (`gh api .../issues/N/labels`), never `gh pr edit --add-label`
(Projects-classic sunset, PR #172).

### D3 — Draft conversion on the reuse path
When a halt PR is a reused OPEN **ready** PR, `ensureHaltPresentation` converts it to draft via
`gh pr ready --undo <url>`. Draft support on this account/repo is confirmed by observed behavior
(#267 is a draft). Create-time `--draft` is retained for the create path.
- *Basis:* verified — `gh pr ready --undo` documented + #267 draft evidence. Confidence 95%.

### D4 — `reconcileHaltPrs()` sweep wired into `runDaemon` startup + idle tick
A new best-effort sweep enumerates OPEN PRs carrying the body marker and calls
`ensureHaltPresentation` on any that are missing draft or label. Wired alongside the existing
`sweepBestEffort()` in `runDaemon` startup (`daemon.ts:457-507`) and the idle tick
(`daemon.ts:739`), via an injected dep hook (ADR-013 pattern) so it is unit-testable with a fake
`GhRunner`. It heals PRs broken before this code shipped or by another checkout (#268/#269) and is
the ultimate safety net when inline verify-after-write is exhausted (sustained rate-limit, #270).
This sweep is **idempotent and additive** — it never removes `needs-remediation` or flips a PR to
ready (that remains the finish-time job, D5).

### D5 — Removal-on-finish gains the same verify-after-write
The existing clear-on-success paths (`daemon-runner.ts:174` and `rehabilitateHaltPr()`,
`halt-pr-rehabilitation.ts:72`) remove the label + flip to ready + (per #271) rewrite title/body.
They also become verify-after-write: re-read to confirm the label is gone and the PR is ready,
retry bounded on failure. The body marker is removed at finish so a rehabilitated PR is no longer
enumerated by the sweep (closing the loop — a finished PR must not be re-halted by reconciliation).

## Consequences

**Positive:** halt-PR presentation becomes guaranteed rather than best-effort; the mergeable-
exposure window closes; pre-existing broken PRs self-heal; the two mechanisms cover each other's
failure modes; all new logic sits behind the injected `GhRunner` seam so it is fully unit-testable
with the existing `makeFakeGh` pattern.

**Negative / trade-offs:** the sweep adds one `gh pr list` per daemon startup + idle tick (bounded,
best-effort, non-throwing); a durable body marker slightly couples reconciliation to PR-body
content (mitigated: the marker is an HTML comment, invisible in rendered Markdown, and removed at
finish). Draft conversion depends on the account plan supporting draft PRs (confirmed for this repo
by #267).

## Alternatives rejected

- **B — reconciliation sweep only:** leaves an exposure window between escalation and the next sweep
  where an un-labeled halt PR presents as MERGEABLE. Contradicts the core requirement.
- **C — verify-after-write + local retry-queue only:** a local queue only knows writes it attempted;
  it cannot heal pre-existing #268/#269 or cross-checkout breakage. Fails the acceptance sketch.
