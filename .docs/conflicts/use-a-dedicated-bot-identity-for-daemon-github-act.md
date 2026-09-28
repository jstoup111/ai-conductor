# Conflict Check: Optional bot identity for harness GitHub writes

**Date:** 2026-09-23
**Stories checked:** `.docs/stories/use-a-dedicated-bot-identity-for-daemon-github-act.md` (Stories 1–6)
**Inventory:** 478 existing story files. Vocabulary greps covered auth, credential, identity,
`@me`, write-back, marker comments, push, retry and fallback, event sinks, and config scope. About
45 stories were read fully or in their relevant sections.
**ADR corpus:** `repo_wide` (`conflict_check.adr_corpus`). All 317 ADRs were examined during
architecture-review's delegated sweep, which read every `## Decision` section. The corpus was
narrowed to 34 ADRs whose subject overlaps these stories: credential, identity, gh seam, remote
git, retry and fallback, event spine, config scope, and child environment. That list is recorded
in
`.docs/decisions/architecture-review-2026-09-23-use-a-dedicated-bot-identity-for-daemon-github-act.md`
§Alignment. The remaining ~283 ADRs were narrowed out as off-subject. Only unambiguously fully
superseded ADRs were excluded. adr-2026-07-03-gated-writeback-announcements (superseded by
ownership D8) was retained for its surviving marker edit-in-place behavior.
**Result:** **PASS — zero blocking conflicts.** Three degrading conflicts were resolved with
operator-selected options, one overlap is compatible, and one gap was closed with a new criterion.
No ADR-versus-story conflict remains after the approved ownership D9 and tracker-seam amendments.

A code check found that no production read locates harness-created PRs or comments by author or
`@me`. The only `@me` reads are intake `--assignee` queries, which stay on the operator's
credential. Bot-authored PRs are therefore never missed by a lookup.

## Conflict: Draft-PR attempt bound vs credential fallback

**Stories involved:** "Daemon early-draft — push + draft PR" (TS-2) vs Story 4
**Files:** `.docs/stories/make-daemon-build-push-pr-timing-a-configurable-st.md` vs `.docs/stories/use-a-dedicated-bot-identity-for-daemon-github-act.md`
**Type:** contradiction
**Severity:** degrading
**Confidence:** 90%. With a bot configured, a bot 401 on draft-PR creation spawns `gh pr create` twice at one publish point.

**Existing (verbatim):** "Given `gh` is unauthenticated, when draft-PR creation fails, then the failure is logged loudly, no retry storm occurs (at most one attempt per publish point), and the build continues to finish where the load-bearing publish path applies."
**New (verbatim):** "one fallback warning with reason `auth-refused` is emitted first and then the same operation, target, and payload run exactly once more with the operator's credential inside the same authorized invocation."

**Bidirectional check:** Satisfying Story 4 breaks the literal bound in TS-2 when a bot is
configured. Satisfying TS-2 literally forbids Story 4 at that site. With no bot configured there
is no conflict, because Story 6 says there is no retry. The intent of TS-2 is no retry storm, and
a bounded single credential substitution preserves that intent.

**Resolution Options:**
1. Replace the TS-2 assertion in place with "at most one attempt per credential per publish point", shipped as a companion main-based story PR because the land stem gate rejects foreign-stem story edits.
2. Accept it as degrading and record the interpretation here only.
3. Exempt draft-PR creation from the fallback.

**Resolution:** Option 1 (operator-selected 2026-09-23). A companion story PR accompanies the spec PR.

## Conflict: Tracker seam story still says "existing auth"

**Stories involved:** TR-6 vs Stories 1 and 2
**Files:** `.docs/stories/canonical-tracker-client-seam-with-per-backend-tra.md` vs `.docs/stories/use-a-dedicated-bot-identity-for-daemon-github-act.md`
**Type:** contradiction
**Severity:** degrading
**Confidence:** 90%. Only the configured-bot case is affected. The ADR side is already reconciled by the approved adr-2026-07-22-canonical-tracker-client-seam item 3 amendment.

**Existing (verbatim):** "Given a project with NO `tracker` key configured, when any engine path runs, then behavior is byte-identical to pre-feature (GitHub via `gh` CLI, existing auth) — no new required config, no warning noise."
**New (verbatim):** "its `gh` child process receives `GH_TOKEN` equal to the token file's contents and every other environment variable is inherited unchanged."

**Resolution Options:**
1. Replace the TR-6 assertion in place with a version that matches the amended ADR ("existing auth, except that GitHub writes use a configured machine-scoped bot credential"), in the same companion story PR.
2. Accept it as degrading.

**Resolution:** Option 1 (operator-selected 2026-09-23).

## Conflict: "Refusal" vocabulary and retry reuse in ownership enforcement

**Stories involved:** Ownership Story 7 and Story 8 (D6/D7) vs Story 4
**Files:** `.docs/stories/enforce-ownership-across-all-harness-github-operat.md` vs `.docs/stories/use-a-dedicated-bot-identity-for-daemon-github-act.md`
**Type:** overlap
**Severity:** degrading (resolved in the new stories)

**Existing (verbatim):** "Given an event/reporting failure after a refused operation, when the result is handled, then no remote write is performed as a fallback and the caller still receives a refusal." / "Given authorization changes between attempts, when retry runs, then it cannot reuse the previous decision as blanket permission."

**Bidirectional check:** Both hold only if three things are true. The bot-auth failure is a type
distinct from an ownership refusal. The operator attempt stays inside the same authorized
invocation. A failed warning emit cannot turn into a silent write.

**Resolution:** The new Story 4 now asserts all three: a distinct type that is never reported as
`github_operation_refused`; later operations and caller-level retries re-authorize and start
again with the bot; and a failed warning emit means no operator retry (operator-selected
2026-09-23, "no silent fallback"). No foreign story changes.

## Overlap (compatible): Marker-comment edit failure

**Files:** `.docs/stories/remediation-comment-upsert.md` (Stories 3 and 4), `.docs/stories/2026-07-03-surface-owner-gated-specs-dashboard-status.md` vs Story 4
All of them forbid creating a comment after a failed edit, and Story 4 falls back only as an
edit. They stay compatible as long as the fallback lives inside the guarded runner, so
`upsertComment` sees a single outcome. That is a plan constraint, and Story 6 requires the
existing upsert tests to pass unchanged.

## Gap closed: Skill-directed writes from provider sessions

**File:** `.docs/stories/enforce-ownership-across-all-harness-github-operat.md` Story 8 ("supported engine and skill-directed publication operations … use the same authorization behavior")
The `github-operation` CLI runs as a descendant of a provider session. Story 2 now requires it to
resolve the bot from the same user config that supplies `spec_owner`. An unreadable token file
still falls back loudly with `token-unavailable` (Story 4).

## Relevant and clean

The following story files are clean. Each was checked in both directions:
- `finish-force-with-lease-after-sanctioned-rebase.md`: a lease failure is not an auth refusal, and argv is unchanged.
- `phase-9.3b-github-intake-writeback.md` and `background-intake-conduct-loop.md`: the `@me` poll is a read, and dedup is keyed on `(sourceRef,status)`.
- `daemon-owner-gate.md`, `multi-operator-ownership-hardening.md`, `multi-operator-ownership-slice-b.md`, `owner-stamped-at-authoring.md`: identity stays on the operator credential.
- `config-keys-that-validate-but-have-no-consumer-inc.md` and `user-level-config-for-8-keys-is-silently-discarded.md`: registry entry and user-only guard.
- `halt-pr-presentation-reliability.md`, `pr-labels-structured-gh-not-found-detection.md`, `2026-07-09-daemon-merged-pr-guard-on-retry.md`, `parked-feature-reconciliation-1060.md`, `engineer-claim-delivery-guard.md`: reads are by URL, head, or ledger, with no author filter.
- `engineer-handoff-pushes-spec-branch-331.md`, `daemon-pr-labels.md`, `phase-9.3-engineer-redesign.md`, `engineer-worktree-isolation.md`: the final failure results are preserved, and argv is unchanged.
- `canonical-tracker-client-seam-with-per-backend-tra.md` TR-2 and TR-4: argv and `GH_REPO` env are unchanged.
- `gh-cli-capability-probe-report-an-unsupported-json.md`: typed class, not text.
- `isolate-daemon-build-auth-from-operator-oauth.md`: a different credential.
- `changelog-unreleased-is-a-shared-write-target-conf.md` and `no-release-time-smoke-or-eval-gate-releases-cut-wi.md`: the CI App identity.
- `codex-auth-sandbox-permission-readiness-905.md`, `interrupted-self-host-runs-leak-provider-homes-unt.md`, `codex-safety-and-self-host-parity-907.md`, `enable-single-repo-daemon-concurrency-un-clamp-the.md`: consistent with Story 5 and the no-`process.env` rule.
