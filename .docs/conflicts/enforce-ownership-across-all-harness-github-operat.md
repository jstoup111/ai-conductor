# Conflict Report: GitHub operation ownership

**Date:** 2026-09-11
**Feature:** enforce-ownership-across-all-harness-github-operat
**Stories:** .docs/stories/enforce-ownership-across-all-harness-github-operat.md (Accepted)
**ADR corpus:** repo_wide, explicitly configured in .ai-conductor/config.yml.
**Verdict:** CLEAN — zero unresolved blocking or degrading conflicts.
**Scan state:** Rechecked after operator-approved supersession. Corpus inventory covers 1,070 story/spec/ADR/prior-report documents; full-text candidate scan and subject inventory narrowed the semantic comparisons to remote operations, ownership, intake, and publication. All eight new stories were compared pairwise and against the applicable decisions.

## Conflict: Other-owner notifications require the very writes the gate refuses

**Stories involved:** New Story 3, Keep all existing-resource updates inside ownership authorization, versus historical Gated spec PR gets a warn-once announcement and label.
**Files:** .docs/stories/enforce-ownership-across-all-harness-github-operat.md; .docs/stories/2026-07-03-surface-owner-gated-specs-dashboard-status.md
**Type:** contradiction
**Severity:** blocking, resolved by operator 2026-09-11
**Root:** architecture; amendment-mode architecture review required.

**ADR filename stem:** adr-2026-07-03-gated-writeback-announcements
**Story ID:** 3
**ADR opposing sentence (verbatim):** "Label `owner-gated` is added when gated."
**Story opposing sentence (verbatim):** "Given a supported mutation against a foreign-owned resource, when requested through any migrated entry point, then it is refused, including labels, comments, body/title edits, state changes, and applicable remote API mutations."

The ADR Decision also requires a reason transition to other-owner to update the living comment:
"since `upsertComment` edits in place, a reason transition (e.g. `unowned-indeterminate` → `other-owner`) updates the one living comment rather than posting anew — matching the waiting-channel ADR's warn-once-per-state-change semantics."

The historical story makes the foreign-owner case explicit:
"Given a spec newly gated as `other-owner: alice` whose spec PR exists, when the pass's write-back runs, then the PR gains the `owner-gated` label and one comment carrying the hidden marker, the reason, and the remedy hint."

**Grounding:** verified by direct reading of the APPROVED ADR and Accepted stories. This is not merely historical feature scope or a compatibility snapshot; it prescribes the ongoing behavior of gated work.

**Two-direction check:** Fully satisfying the historical notification requirement mutates a foreign PR and violates new Story 3. Fully satisfying new Story 3 prevents that notification and violates the historical requirement. Without supersession the two authorities can cause repeated review kickbacks.

### Resolution options

1. **Recommended: supersede the cross-owner remote announcement requirement.** Keep GATED discovery, dashboard, and status visibility. Route refused mutations through the approved canonical refusal/event behavior. Retain authorized-resource idempotency and best-effort behavior, but never send a comment or label as a fallback on a foreign resource.
2. Keep an exception for cross-owner labels/comments. This would contradict the operator-approved all-mutations policy and requires reopening that policy. It is not recommended.

### Concrete amendment scope

- A superseding ADR explicitly retires the foreign-resource notification requirement in adr-2026-07-03-gated-writeback-announcements, preserving authorized marker upserts, per-surface best-effort behavior, and local-before-remote visibility.
- Amend the old ADR status/reference; retain its historical text.
- Update the two writeback stories in 2026-07-03-surface-owner-gated-specs-dashboard-status.md in place so PR and issue mutations require independent target authorization and other-owner refusals preserve local visibility.
- Update the corresponding authorization clauses in 2026-07-22-daemon-suppress-other-owner-log-noise.md. Its current Story 1 says a later other-owner PR still receives label/comment writes; its Done When and Story 3 repeat that behavior. Keep its verbosity behavior for non-mutating skip notices.
- Amend the owning PRD's FR-8/FR-9 remote-write assertions additively during DECIDE; do not delegate these protected artifact amendments to BUILD.
- Bind the gate-writeback production integration to new Story 3 in the implementation plan.
- Re-run the full conflict scan before authoring that plan.

The operator has approved the new ownership policy. The operator then explicitly approved retirement of the old remote notification requirement ("aligned"). New ADR D8 records the resolution; the old ADR is fully superseded, and its owning stories/PRD are corrected in this spec before BUILD.

## Examined ADRs and related evidence

- adr-2026-09-11-github-operation-ownership: new D1-D7, including no mutation fallback.
- adr-2026-07-03-gated-writeback-announcements: retained as APPROVED; direct conflict above.
- adr-2026-07-03-owner-gate-gated-channel: compatible local discovery/display behavior, no supersession proposed.
- adr-015-daemon-pr-labeling-sweep: best-effort integration contract; requires follow-up comparison against typed refusals, not dismissed as superseded.
- adr-2026-07-22-canonical-tracker-client-seam: canonical interface reused; original feature-only PR migration exclusion is not a permanent ban on this feature.
- adr-2026-06-30-owner-provenance-recording and adr-2026-07-01-machine-scoped-operator-identity: identity/provenance foundations retained.

The broad candidate inventory is retained in .pipeline/2516-conflict-candidates.txt. The final corpus disposition is recorded below. Fully superseded gated-writeback is historical evidence only; ambiguous or partial supersessions are retained for their applicable clauses.

## Validation

Accepted-story transfer and approved architecture artifacts passed the prior integrity run: 302 passed, zero failed, one warning (historical tdd model-table row). No production implementation has been authored.


## Re-check and compatibility decisions

- **New story pairs (all 28):** identity and target validation feed every mutation; authorized paths coexist with denials; creation is a one-transaction authority and later operations reauthorize; reads cannot convey mutation permission. Shared label application and shared definition changes are distinct operations. Local Git behavior remains outside the remote adapter. No contradictory state, circular sequencing, resource exclusivity, or oscillation remains.
- **Gated writeback and verbosity:** resolved by D8 and in-place story amendments. No-target skip logging remains optional; typed refusal/event evidence is not a forced repetition of suppressed skip text. Local snapshots remain unchanged.
- **Dispatch gate and grandfathering:** dispatch eligibility remains a separate policy; it does not grant remote mutation permission. Existing owned/unowned discovery and dashboard contracts can hold while remote writes are denied. No attempt to rewrite all historical eligibility rules.
- **Canonical tracker interface:** preserve the backend-neutral TrackerClient and canonical GhRunner transport. Original feature-specific promises of no PR migration are historical change scope, not a permanent architectural prohibition. Authorization is added above the transport.
- **Halt reliability, rehabilitation, and resume:** selection by halt marker and shipment evidence remains intact, but selected targets require permission before write. Preserve finish-only ready transitions and resume preserve-draft semantics. Denial is not confirmed cleanup; existing partial/failure behavior still reports truthfully.
- **Halt-issue closure and quotas:** eligibility remains local-first; a steady-state sweep does not resolve remote authorization because it requests no mutation. For actual writes, request ownership fields with the existing issue-state read; do not append a separate read for each metadata field. No recurrence guard or keep-open override is removed.
- **Intake capture and routing:** assigned-to-me discovery is a read. It can discover a multiply assigned issue while mutation authorization refuses it; discovery is not permission. Labels, comments, close, and source references remain independently scoped; assignees are preserved.
- **Intake label synchronization:** existing/external label namespace authority determines desired labels after ownership admission. Definition creation remains separate from applying a label; this feature does not alter size/priority precedence.
- **Publication:** ownership is an additional precondition, not replacement for validation, current-head evidence, intent, post-write observation, or force-with-lease. Denials do not become recorded progress and do not route to an unauthorized escalation write.
- **Source refs, dependency reads, and terminal resources:** canonical parsing stays in place; reading another issue as a dependency does not authorize changing it. Closed/merged state is not ownership, and does not by itself prohibit an otherwise permitted update.
- **Process isolation and provider parity:** production adapters and supported CLI entry points share enforcement. Tests fake the terminal process/network boundary; no reliance on a missing guard for isolation. No Claude-only hook is the enforcement authority.

All comparisons use both directions: satisfying the older preserved behavior still allows the new gate to deny unauthorized effects; satisfying the gate preserves the authorized old behavior. The one explicit contrary foreign-write requirement was superseded, not silently treated as compatible.

## Corpus disposition

The inventory read every document for subject and relevant operation terms. ADRs outside the affected subject are narrowed out by domain, not by age or uncertain supersession. The following lists record that selection. The selected group includes inherited constraints and ambiguous historical status; only explicit full supersession is excluded from authority.

### Selected ADR subjects

- .docs/decisions/adr-006-flywheel-lesson-selection-and-provenance.md — **Status:** APPROVED
- .docs/decisions/adr-008-agent-hosted-loop-and-in-chat-authoring.md — **Status:** APPROVED
- .docs/decisions/adr-009-intake-adapter-port.md — **Status:** APPROVED
- .docs/decisions/adr-011-async-intake-queue-and-github-source.md — unspecified
- .docs/decisions/adr-012-durable-intake-ledger-sole-dedup-authority.md — unspecified
- .docs/decisions/adr-015-daemon-pr-labeling-sweep.md — **Status:** APPROVED
- .docs/decisions/adr-2026-06-29-rebase-conflict-resolution-dispatch.md — **Status:** APPROVED
- .docs/decisions/adr-2026-06-30-background-intake-brain-loop.md — **Status:** APPROVED
- .docs/decisions/adr-2026-06-30-origin-seeded-intake-routing.md — **Status:** APPROVED
- .docs/decisions/adr-2026-06-30-owner-gate-identity-resolution.md — **Status:** APPROVED
- .docs/decisions/adr-2026-06-30-owner-provenance-recording.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-01-machine-scoped-operator-identity.md — Status: Approved
- .docs/decisions/adr-2026-07-03-gated-snapshot-status-read-model.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-03-gated-writeback-announcements.md — **Status:** SUPERSEDED by adr-2026-09-11-github-operation-ownership
- .docs/decisions/adr-2026-07-03-halt-pr-rehabilitation-at-finish.md — unspecified
- .docs/decisions/adr-2026-07-03-issue-dependencies-api-surface.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-03-owner-gate-gated-channel.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-03-post-rebase-force-with-lease.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-04-claim-time-delivery-evidence-guard.md — unspecified
- .docs/decisions/adr-2026-07-05-halt-pr-presentation-reliability.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-08-halt-issue-closure-sweep.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-08-main-checkout-leak-triage-and-write-fence.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-10-intake-claim-priority-banding.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-12-progress-aware-build-halt.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-21-intake-only-enforcement.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-21-serena-removal-path.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-22-canonical-tagged-source-ref.md — Status: APPROVED
- .docs/decisions/adr-2026-07-22-coherence-waiver-and-duplicate-claim.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-22-intake-closed-issue-reconciliation.md — Status: APPROVED
- .docs/decisions/adr-2026-07-23-intake-label-authority-scoped-replace.md — **Status:** APPROVED
- .docs/decisions/adr-2026-07-26-rebase-tail-current-branch-before-publication.md — **Status:** APPROVED (operator-approved 2026-07-26)
- .docs/decisions/adr-2026-08-01-engine-owned-resumable-finish-publication.md — unspecified
- .docs/decisions/adr-2026-08-06-bounded-progress-allowance-for-finish-publication.md — **Status:** APPROVED
- .docs/decisions/adr-2026-08-06-publication-progress-is-its-own-disposition.md — **Status:** APPROVED
- .docs/decisions/adr-2026-08-07-smoke-gate-goes-live-without-precharacterization.md — **Status:** APPROVED (operator-approved 2026-08-07)
- .docs/decisions/adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance.md — Status: APPROVED
- .docs/decisions/adr-2026-08-09-adr-layer-gated-by-committed-adr-signal.md — **Status:** Approved
- .docs/decisions/adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator.md — **Status: APPROVED**
- .docs/decisions/adr-2026-08-12-fail-closed-intake-ledger-durability.md — **Status:** APPROVED
- .docs/decisions/adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns.md — **Status:** APPROVED (operator, 2026-08-13)
- .docs/decisions/adr-2026-08-16-restore-the-current-head-publication-fence.md — unspecified
- .docs/decisions/adr-2026-08-26-setup-once-per-worktree-marker.md — **Status:** APPROVED
- .docs/decisions/adr-2026-08-27-daemon-dispatcher-executor-seam.md — **Status:** APPROVED
- .docs/decisions/adr-2026-09-06-inbound-intake-trust-boundary.md — **Status:** APPROVED
- .docs/decisions/adr-2026-09-11-github-operation-ownership.md — **Status:** APPROVED

### Narrowed-out ADR subjects

- .docs/decisions/adr-002-engineer-store-and-retro-redirect.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-003-registry-write-and-integration.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-005-non-autonomy-and-read-only-governor.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-010-pidfile-lock-daemon-liveness.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-014-otel-observability-exporter.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-architecture-before-stories-convergent-kickback.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-brainstorm-rename-migration.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-explore-prd-split-track-in-explore.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-memory-resilience-write-fallback-and-reconcile.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-per-project-memory-provider-selection.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-per-provider-retrieval-guidance-location.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-platform-adoption-and-removal-surface.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-safe-reversible-memory-migration.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-shared-memory-store-placement-and-durability.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-29-track-marker-location.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-30-engineer-worktree-authoring-isolation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-30-grandfather-cutover-merge-time.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-30-halt-based-release-gates.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-30-sandbox-build-isolation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-06-30-self-host-detection-seam.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-daemon-auto-restart-stale-engine.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-dependency-fail-closed-and-cache.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-dependency-gate-backlog-waiting-channel.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-generated-model-table-single-source.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-harness-daemon-profile.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-pr-timing-config-key.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-pr-timing-self-host-precedence.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-priority-fetch-fail-soft.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-priority-from-linked-issue-labels.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-prose-to-link-migration.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-reactive-model-fallback-ladder.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-03-version-gate-semver-escalation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-auth-failure-park-and-poll.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-autoresolve-state-and-config.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-durable-pause-marker.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-event-driven-halt-clear-wake.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-kickback-event-emission-and-log-prominence.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-operator-park-marker.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-park-unpark-cli-verbs.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-pending-restart-queue.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-resolution-worktree-lifecycle.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-respawn-in-place-restart.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-versioned-engine-store-atomic-flip.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-05-daemon-rate-limit-episode-coordinator.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-05-engine-owned-task-status.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-05-retry-as-escalation-ladder.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-05-standalone-bin-update.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-06-daemon-false-ship-guard.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-06-installed-root-resolution-for-global-writes.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-06-manual-test-fail-routing.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-06-migration-gate-waiver.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-06-stale-engine-respawn-in-place.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-07-audit-trail-event-sink.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-07-daemon-owned-build-credential.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-07-finish-record-primitive.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-07-ship-ci-feedback-loop.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-07-single-generation-stale-respawn.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-07-task-trailer-id-alias.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-09-deterministic-evidence-attribution-enforcement.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-09-setup-failure-triage.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-10-concurrent-group-core.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-10-daemon-stall-remediation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-10-evidence-range-anchor-resolution.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-10-inline-work-attribution-enforcement.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-10-intra-step-build-progress-events.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-10-observed-close-watch-registry.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-10-park-marker-main-root-resolution.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-10-retire-migration-grandfather.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-10-session-hook-task-stamping.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-10-validation-group-join.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-11-attribution-abstain-or-loud.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-11-attribution-spot-audit-measurement.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-11-attribution-verdict-interface.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-11-evidence-judge-cli-and-cutover.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-11-finish-step-engine-completion-machinery.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-11-pipeline-state-durability.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-11-semantic-attribution-verification-lane.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-11-verdict-aware-resume-entry.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-12-judged-attribution-verdict-persistence.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-12-rebase-evidence-stamp-translation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-12-wired-into-contract.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-12-wiring-check-gate.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-13-kickback-build-no-op-escalation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-13-park-all-dispatch-paths.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-13-retry-classify-rerun-vs-route.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-13-session-fresh-verdict-artifacts.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-17-verify-only-judged-closure.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-20-bounded-dirname-path-corroboration.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-20-ci-fix-dispatch-via-steprunner.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-20-ci-fix-startup-preflight-and-error-classification.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-20-post-rebase-delta-aware-invalidation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-21-completeness-as-build-review-rubric.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-21-decide-time-unmerged-overlap-scan.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-21-demote-task-stamping-to-telemetry.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-21-engine-owned-acceptance-red-execution.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-21-no-diff-task-evidence-stamp.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-21-owner-stamped-at-authoring.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-21-s-tier-pipeline-knobs.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-attempts-counter-on-crash-recovery.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-auth-failure-classification-observed-401-patterns.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-build-dispatch-json-usage-capture.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-canonical-tracker-client-seam.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-coherence-gate-placement-and-validation-split.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-daemon-level-missing-credential-gate.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-examples-state-isolation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-headless-vs-guided-examples.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-heartbeat-lease-deferred.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-origin-refresh-before-engine-rebuild.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-per-feature-cost-rollup-in-shipped-record.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-per-task-work-happened-floor.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-phase-scoped-docs-write-guard.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-requeue-claimed-distinct-from-reopen.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-stale-claim-staleness-window-default.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-22-token-liveness-probe-via-cli-invocation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-23-build-review-fresh-base-disposition.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-23-commit-movement-liveness-floor.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-23-session-hook-repair-before-halt.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-23-trailer-union-build-step-routing.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-25-content-addressed-full-suite-proof.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-25-custom-step-completion-artifacts.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-25-fail-closed-durable-shipment-evidence.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-26-daemon-decide-preseed-ownership.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-26-event-sink-registry-exhaustiveness.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-26-protected-artifact-seal-rebaseline.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-27-ancestry-proven-park-reconciliation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-27-cold-start-within-step-retries.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-27-cost-unmetered-is-a-first-class-state.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-27-daemon-decide-kickback-halt.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-27-project-config-scaffolder.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-28-feature-aware-artifact-resolution.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-28-total-halt-classification-legacy-boundary.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-29-codex-readiness-probe-failure-disposition.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-29-deterministic-build-verification-fanout.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-29-engine-observed-provider-time-partition.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-29-operator-park-scheduling-unit-boundary.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-29-ship-start-draft-pr.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-30-contract-aware-same-file-wiring.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-30-finish-only-mergeability-gate.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-30-pinned-remote-theme-for-pages-navigation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-07-30-provider-preparation-lifecycle-supervision.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-01-bot-owned-release-pr.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-01-conduct-state-mutation-port.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-01-engine-owned-scoped-test-invocation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-01-multi-proof-park-deletion-authority.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-01-rebase-full-replay-intent-validation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-01-scoped-run-verb-release-surface.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-02-live-tier-asserts-outcomes-not-scripts.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-02-plan-scope-containment-at-commit-boundary.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-03-build-repair-member-reuse-validity.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-03-fail-closed-decide-entry.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-03-ledgered-per-block-migration-execution.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-03-uncommitted-work-floor-under-build-completion.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-04-classify-before-spend-release-smoke-gate.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-04-live-tier-provisions-its-own-provider-home.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-04-unresolved-step-command-fails-by-name.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-05-blocked-classification-after-dedup.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-05-blocked-is-a-distinct-state-from-halted.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-05-build-settle-outcome-stamp.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-05-provenance-based-protected-artifact-inheritance.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-05-token-first-stories-reference-normalization.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-05-worktree-classification-evidence-derived-reasons.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-06-honest-park-termination-boundary.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-07-project-teardown-hook-contract-and-containment.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-07-worktree-removal-coverage-guard.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-08-finish-human-required-halt-rendering.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-08-pipeline-owned-closeout-timestamps.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-08-single-adr-approval-parser-three-rungs.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-adr-contradiction-detection-in-two-halves.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-bash-yaml-access-via-conduct-ts-config.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-checkout-is-sole-version-identity-authority.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-conductor-block-single-source-of-truth.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-declared-pattern-replication-in-build.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-hook-owned-containment-event-ledger.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-legacy-json-seed-migration-rule.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-non-blocking-plan-scope-containment.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-operator-only-scoped-artifact-reseal.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-recorded-red-exception-for-remediation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-reseal-audit-rides-the-existing-event-spine.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-seal-rotation-authorship-predicate.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-09-worktree-local-provider-scratch.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-11-deprecated-no-op-step-retirement.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-11-halt-events-ride-the-persisted-spine.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-12-cumulative-build-review-convergence-bound.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-12-execution-lifecycle-completeness-for-timing.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-12-live-provider-coverage-from-plugin-registry.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-12-operator-reseal-as-second-scope-justification.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-12-per-provider-live-smoke-legs.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-12-removal-anchored-tautology-exemption.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-13-durable-base-advance-attribution.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-13-engine-managed-build-review-rubric-branches.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-13-markdown-default-inversion.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-13-stable-build-review-finding-dispositions.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-14-retire-build-review-wiring-rubric.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-15-verify-only-anchored-tautology-exemption.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-16-closed-build-review-finding-vocabularies.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-16-preservation-anchored-completeness-exemption.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-17-framework-agnostic-tautology-scoped-run.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-17-structural-live-checkout-containment.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-18-content-anchored-finding-reference-schema.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-19-engine-stamped-rubric-judged-result-envelope.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-19-live-provider-stream-observation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-19-operator-step-rewind-through-the-mutation-port.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-19-unretryable-step-runner-failures-route-by-kind.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-21-engine-identity-in-build-review-cache-key.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-21-review-bound-by-plan-done-when-criteria.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-22-as-built-review-runs-always-with-plan-gap.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-22-build-review-opt-in-rubric-container.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-22-done-when-evidence-at-task-close.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-22-one-owner-per-review-question.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-23-committed-halt-record.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-23-criterion-layer-is-structural-at-land.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-23-diff-locality-is-an-authored-disposition.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-24-evidentiary-defects-are-not-waivable.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-24-one-dispatch-member-on-the-provider-contract.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-24-over-scope-decision-block-and-durable-refusals.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-24-refused-step-status.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-25-as-built-remediable-findings-bounded-build-route.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-26-music-vocabulary-player-composer-rename.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-26-remove-retrospectives-one-shot.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-26-shared-coherence-parser-at-discovery.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-28-test-suite-drift-budget-and-verification-mode.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-29-build-review-remediate-case-adjudication.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-29-operator-authorized-kickback-budget-recovery.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-30-shared-plan-task-reference-resolver.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-31-coverage-binding-judge-step.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-08-31-kickback-ledger-read-fails-closed.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-09-02-adr-decision-citability-contract.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-09-05-gh-cli-version-floor-and-environment-gate.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-09-06-engine-owned-test-quality-scope.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-09-06-reopened-task-resolution.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-09-07-durable-prd-widening-decision-reconciliation.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-09-10-shared-step-lifecycle-telemetry.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.
- .docs/decisions/adr-2026-09-11-finish-mergeability-respects-active-review-inputs.md — no intersecting remote-operation/ownership requirement identified in the subject and full-text inventory.

### Selected story/spec/prior-report subjects

- .docs/stories/2026-07-03-intake-marker-plan-stem-keying.md
- .docs/stories/2026-07-03-surface-owner-gated-specs-dashboard-status.md
- .docs/stories/2026-07-05-rekick-gated-rebase-resolution.md
- .docs/stories/2026-07-10-priority-banded-intake-claim.md
- .docs/stories/2026-07-22-daemon-suppress-other-owner-log-noise.md
- .docs/stories/a-successful-finish-publication-transition-consume.md
- .docs/stories/background-intake-conduct-loop.md
- .docs/stories/close-already-fixed-intake-issues-from-compose-for.md
- .docs/stories/daemon-owner-gate.md
- .docs/stories/daemon-pr-labels.md
- .docs/stories/dependency-ordered-intake-and-dispatch.md
- .docs/stories/enforce-ownership-across-all-harness-github-operat.md
- .docs/stories/finish-force-with-lease-after-sanctioned-rebase.md
- .docs/stories/finish-publication-burns-its-retry-budget-on-an-un.md
- .docs/stories/finish-should-rewrite-stale-needs-remediation-titl.md
- .docs/stories/generalize-source-ref-parsing-formatting-to-suppor.md
- .docs/stories/github-issue-text-reaches-an-autonomous-build-with.md
- .docs/stories/halt-pr-presentation-reliability.md
- .docs/stories/halt-pr-reconciliation-sweep-logs-on-delta-only-52.md
- .docs/stories/harden-intake-ledger-durability.md
- .docs/stories/intake-claim-closed-issue-guard-and-brain-sweep.md
- .docs/stories/intake-convention-issues-state-what-and-desired-ou.md
- .docs/stories/intake-issue-pr-link-autoclose.md
- .docs/stories/intake-only-enforcement.md
- .docs/stories/manual-rebase-strands-protected-artifact-seal.md
- .docs/stories/page-background-intake-past-github-default-30-issu.md
- .docs/stories/phase-9.3-engineer-redesign.md
- .docs/stories/phase-9.3b-github-intake-writeback.md
- .docs/stories/pr-labels-structured-gh-not-found-detection.md
- .docs/stories/rebase-resolution-skill.md
- .docs/stories/report-live-durable-intake-queue-depth-in-brain-st.md
- .docs/stories/reused-halt-pr-ships-with-halt-boilerplate-body-an.md
- .docs/stories/ship-tail-parallel-validation-serial-publication-922.md
- .docs/stories/stage-intake-outcomes-when-the-desired-outcome-hea.md
- .docs/stories/unattended-finish-spends-minutes-before-determinis.md
- .docs/specs/2026-06-26-phase-9.3-engineer-redesign.md
- .docs/specs/2026-06-27-phase-9.3b-github-intake-writeback.md
- .docs/specs/2026-06-29-daemon-pr-labels.md
- .docs/specs/2026-06-29-rebase-resolution-skill.md
- .docs/specs/2026-06-30-background-intake-conduct-loop.md
- .docs/specs/2026-06-30-daemon-owner-gate.md
- .docs/specs/2026-07-03-dependency-ordered-intake-and-dispatch.md
- .docs/specs/2026-07-03-surface-owner-gated-specs-dashboard-status.md
- .docs/specs/2026-07-22-engineer-unclaim-requeue-verb-stale-claimed-ledger.md
- .docs/specs/2026-08-01-unattended-finish-publication.md
- .docs/specs/intake-issue-pr-link-autoclose.md
- .docs/conflicts/2026-06-29-daemon-pr-labels.md
- .docs/conflicts/2026-06-30-background-intake-conduct-loop.md
- .docs/conflicts/2026-06-30-daemon-owner-gate.md
- .docs/conflicts/2026-07-03-dependency-ordering-vs-priority-scheduling.md
- .docs/conflicts/2026-07-03-halt-pr-rehabilitation.md
- .docs/conflicts/2026-07-03-surface-owner-gated-specs-dashboard-status.md
- .docs/conflicts/2026-07-05-halt-pr-reliability.md
- .docs/conflicts/2026-07-10-priority-banded-intake-claim.md
- .docs/conflicts/2026-07-22-generalize-source-ref-parsing.md
- .docs/conflicts/2026-07-22-intake-claim-closed-issue-guard-and-brain-sweep.md
- .docs/conflicts/2026-07-23-intake-label-authority.md
- .docs/conflicts/2026-08-01-unattended-finish-publication.md
- .docs/conflicts/2026-09-11-github-operation-ownership.md
- .docs/conflicts/a-successful-finish-publication-transition-consume.md
- .docs/conflicts/finish-publication-burns-its-retry-budget-on-an-un.md
- .docs/conflicts/github-issue-text-reaches-an-autonomous-build-with.md
- .docs/conflicts/harden-intake-ledger-durability.md
- .docs/conflicts/intake-only-enforcement.md
- .docs/conflicts/manual-rebase-strands-protected-artifact-seal.md
