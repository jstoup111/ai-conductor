---
status: APPROVED
date: 2026-07-25
approved: 2026-07-25
supersedes: adr-2026-07-03-committed-shipped-record-dispatch-dedup, adr-2026-07-09-mid-run-merged-pr-guard
amends: adr-2026-07-07-finish-record-primitive, adr-2026-07-07-ship-ci-feedback-loop
deciders: James Stoup
issues: "#916, #936"
---

# ADR: Fail-Closed Durable Shipment Evidence

## Status

APPROVED — operator-confirmed 2026-07-25.

## Context

The repository has durable shipped records, but their production is advisory. The 2026-07-03 ADR
permits a write failure to degrade to the local processed cache, while the 2026-07-09 merged-PR
guard may synthesize terminal state after an out-of-band merge without landing a record. That leaves
the durable repository evidence incomplete and allows fresh clones to redispatch already shipped
work. Issues #916 and #936 define the failure case: a plan/spec has a provably associated merged
implementation PR, but no valid shipped record.

The implementation already contains the record hash, renderer, parser, writer, finish recorder,
completion predicates, daemon teardown boundary, merged-PR guard, and mergeable watch. PR #937 also
made the skill-driven `/finish` sequence create, verify, and push the record before local completion;
PR #943 subsequently exercised that path successfully on `main`. The remaining failure is not the
normal producer sequence but the absence of engine-owned validation, protected-merge enforcement,
and automatic detection/recovery when that sequence is bypassed or fails. The smallest coherent
change is to add one fail-closed policy verifier and reuse the existing seams.

`main` is already protected by active repository ruleset `15933604`; the missing protection is a
required durable-evidence status check. Actions currently default to read-only, cannot create or
approve pull requests, and have no alternate GitHub App/PAT secret.

## Decision

1. **One durable-evidence contract.** Add a shared verifier over the existing shipped-record format.
   Given a plan slug and implementation PR identity, it requires:
   - exactly one `.docs/shipped/<slug>.md` record;
   - parseable frontmatter whose `slug` and `pr` exactly match the expected values;
   - `spec_hash` equal to the existing canonical hash of the committed plan and any stories resolved
     by the current writer/discovery semantics;
   - the record path included in the candidate Git commit; and
   - for engine completion, that commit verified on the implementation PR head/upstream.
   The verifier returns a closed result (`valid`, `not-applicable`, or a typed refusal); callers do
   not reinterpret partial evidence. Existing parsing remains permissive for discovery dedup, but
   completion verification is strict.

2. **Fail closed at every terminal boundary without replacing #937.** The skill remains the normal
   record producer. For PR finishes, `finish-record`, the finish
   completion predicate, `complete-verifier`, daemon verified-ship/teardown, rekick recovery, and the
   merged-PR guard must all receive `valid` before writing or accepting terminal ship state. Missing,
   malformed, mismatched, uncommitted, or unpushed evidence HALTs with remediation details. Local
   `.daemon/processed` markers remain a performance cache and never substitute for durable evidence.
   `keep` and `discard` are not shipments and remain outside this contract.

3. **Deterministic PR association.** A PR is an implementation candidate only when an exact plan
   stem is corroborated by repository/GitHub evidence: an exact slug in the engine's PR metadata
   (branch/title/body convention), a plan at that stem, and at least one non-spec implementation
   change. Zero or multiple matches are `not-applicable` for the premerge gate and are reported as
   ambiguous by reconciliation; they never cause a record to be fabricated. The engine path already
   knows its slug and does not depend on inference.

4. **Required premerge check.** Add an always-reporting `pull_request` GitHub Action with no path
   filter. For a deterministically associated implementation PR it runs the shared verifier against
   the PR head; a missing/invalid record fails. Non-implementation and record-only repair PRs report
   success as `not-applicable`. Add this stable check context to existing ruleset `15933604` without
   weakening its PR, review, merge-method, or destructive-update rules. Administrative bypass remains
   a repository governance setting, not an engine success path.

   The premerge job derives the implementation URL, PR body, base/head SHAs, and changed paths from
   the checked-out `pull_request` event plus `git diff <base>...<head>`. It does not call `gh pr view`:
   the event head is the authoritative CI binding, and the shared verifier still proves the durable
   record, canonical hash, and exact checked-out commit. This keeps the required check usable with
   read-only CI credentials.

5. **Post-merge reconciliation through human repair PRs.** On a merged PR, an Action reruns the
   association and verifier against `main`. If valid, it exits. If the association is proven and the
   record is absent/invalid, it creates or updates a deterministic record-only branch and PR. The
   branch/PR key is `<implementation-pr-number>/<slug>`, making retries idempotent. It never pushes to
   `main`, enables auto-merge, requests/creates an approval, or merges. Because `GITHUB_TOKEN`-created
   PR events do not recursively launch the normal PR workflow, the reconciliation job runs the same
   verifier on its repair commit and posts the stable required status itself.

6. **Least-privilege Action authorization.** Enable the repository setting permitting Actions to
   create pull requests. Keep the repository default token read-only; grant the reconciliation job
   only `contents: write`, `pull-requests: write`, and `statuses: write`. The premerge verifier remains
   read-only. This setting technically permits an explicitly authorized workflow to request review
   actions, so the repository-owned workflow and tests enforce the stronger rule that this job only
   creates/updates a repair PR. A GitHub App is rejected for this slice because none exists and its
   additional identity/secret lifecycle is unnecessary.

7. **Bounded historical backfill.** A one-time audit considers every committed plan/spec, searches
   merged PR history, and applies the same exact association rules. Proven missing records are
   generated on this feature branch for human review. Ambiguous, absent, or contradictory matches are
   emitted in a machine-readable report and skipped. Candidate counts and local processed markers
   are discovery hints only. The audit is idempotent and never rewrites a valid record.

8. **Carry forward stable behavior.** Records still land on implementation branches before human
   merge through the #937 sequence; canonical hashing and story resolution, stem/hash discovery
   dedup, local cache repair, and main-advance rekick behavior remain unchanged except that no
   terminal completion can be synthesized without valid durable evidence. Changing the record
   schema or which historical story-link forms participate in the digest is out of scope.

## Consequences

- A shipped implementation and its durable record normally land atomically; missing evidence blocks
  engine completion and protected-branch merge.
- Out-of-band/manual merges no longer become synthetic local ships. They trigger a visible HALT and
  an idempotent, human-merged repair path.
- Fresh clones can rely on repository evidence rather than machine-local markers.
- The design adds no service, database, dependency, or automated merge authority. It does add one
  repository setting and a write-scoped reconciliation job.
- Association intentionally favors false negatives over false positives. Ambiguous history remains
  reported work rather than fabricated shipment evidence.
- A `GITHUB_TOKEN` repair PR cannot rely on recursive workflow triggers; posting the verified status
  from the creating job is therefore part of the recovery contract.

## Alternatives Rejected

- **Retain cache fallback:** preserves the known failure and violates #916/#936.
- **Directly push repaired records to `main`:** bypasses existing human review and protected-branch
  governance.
- **Auto-merge repair PRs:** conflicts with ADR-005's non-autonomy boundary and the operator's
  explicit decision.
- **Backfill every missing same-stem record:** candidate absence does not prove a merged
  implementation and can fabricate history.
- **Install a GitHub App now:** gives clean event provenance but adds credentials and operational
  lifecycle disproportionate to this reduced slice.
- **Separate verifier implementations for engine and CI:** invites policy drift at the exact seam
  this feature is meant to harden.

## Compatibility and Supersession

This ADR supersedes only the conflicting clauses of the 2026-07-03 cache-degradation decision and
the 2026-07-09 synthetic merged-PR completion decision. Their record-on-branch, hash/stem dedup,
cache-repair, discovery, and rekick decisions remain in force. It aligns with the finish-record
primitive, daemon false-ship guard, ship-CI feedback loop, and ADR-005 human-control boundary.

## Evidence

- Repository/code observations and confidence are recorded in
  `.pipeline/verify-claims-architecture-review.md`.
- PR #937, merged 2026-07-25, is the skill-level prerequisite; PR #943 is the verified production
  example whose implementation and shipped record landed together.
- GitHub protected-branch and status-check behavior:
  <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
- GitHub `GITHUB_TOKEN` permissions and event recursion behavior:
  <https://docs.github.com/en/actions/concepts/security/github_token>
- GitHub Actions repository settings:
  <https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository>
