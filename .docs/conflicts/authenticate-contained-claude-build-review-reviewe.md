# Conflict Check: Authenticate contained Claude build_review reviewers

**Date:** 2026-09-24
**Stories checked:** `.docs/stories/authenticate-contained-claude-build-review-reviewe.md` (Stories 1–4) against the existing story corpus
**ADR corpus:** `repo_wide` (per `.ai-conductor/config.yml`)
**Result:** PASSED — zero blocking conflicts; one degrading overlap accepted as designed

## Degrading overlap: the daemon-level gate front-runs the reviewer credential refusal

**Stories involved:** Story 2 and Story 4 (missing daemon token refusal) vs Story "per-feature pre-flight" of isolate-daemon-build-auth-from-operator-oauth, and adr-2026-07-22-daemon-level-missing-credential-gate
**Files:** [.docs/stories/authenticate-contained-claude-build-review-reviewe.md] vs [.docs/stories/isolate-daemon-build-auth-from-operator-oauth.md], [.docs/decisions/adr-2026-07-22-daemon-level-missing-credential-gate.md]
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-07-22-daemon-level-missing-credential-gate
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "In daemon-token mode with the credential missing/unreadable, the daemon: […] **parks the whole dispatch cycle** on the credential source using the existing park-and-poll machinery"
**Story opposing sentence (verbatim):** "Given `daemon-token` mode and no daemon token file, when a lap with a contained Claude member runs, then no Claude reviewer is launched, the member settles with `reviewer-credential-unavailable`, and the feature halts `needs-human`"

**Description:** In a daemon run the gate parks dispatch before any feature reaches build_review, so Story 4's refusal is reached only in interactive runs or when the token disappears after the gate passed. Both hold: the gate is primary for daemons; the refusal is the fail-closed backstop, the same relationship ADR 2026-07-22 Decision 3 already records for the per-feature preflight.

**Resolution Options:**
1. Keep both; treat the reviewer refusal as the backstop and test it directly at the member-preparation seam.
2. Drop the refusal and rely on the gate alone.
3. Route the refusal into the gate's park.

**Recommendation:** Option 1, adopted. Option 2 leaves interactive runs and races burning three laps (outcome 3); option 3 would park on a condition the gate already owns and give the halt no lever.

## Resolved during this check (design narrowed, operator-approved)

- **Build-auth mode discriminator.** `resolveSelfHostConfig` resolves an absent `build_auth` block to `daemon-token` (`src/conductor/src/engine/resolved-config.ts`), and `daemon-cli.ts` wires the daemon token gate for every project. The earlier story draft treated an absent block as a distinct mode that read the operator's stored login. The operator chose to key the reviewer on the resolved mode; the stories, ADR amendment adr-2026-07-07-daemon-owned-build-credential Decisions 6–8, diagrams, and architecture review were rewritten accordingly before landing. The operator-login read and host-side refresh story was removed.
- **Operator credentials never read.** `isolate-daemon-build-auth-from-operator-oauth` scopes "never copied, read, or rotated" to self-host sandbox builds; the narrowed design never reads the operator's login at all, so no overlap remains.
- **Live-boundary fingerprint.** Not implicated: the narrowed design runs no host-side refresh, and `.credentials.json` is excluded from the fingerprint via `selectedAuthPaths` (`src/conductor/src/engine/self-host/live-boundary.ts`).
- **needs-human halt vs bounded mechanical lane.** `review-infrastructure-failures-are-operator-unreco` gives generic mechanical faults three laps; adr-2026-08-18 D2.3/D3.2 carve this deterministic cause out exactly as D3.1 does for `projection-oversized`. No oscillation: satisfying Story 4 leaves the generic three-lap behaviour intact (Story 4 negative paths assert it), and the generic behaviour never applies to this cause.

## Corpus

**Examined in full:** isolate-daemon-build-auth-from-operator-oauth, sandbox-auth-expiry-park, build-auth-token-check-and-classify, review-infrastructure-failures-are-operator-unreco, pi-as-a-build-provider; ADRs adr-2026-07-07-daemon-owned-build-credential, adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane, adr-2026-07-22-daemon-level-missing-credential-gate, adr-2026-09-10-portable-build-review-policy, plus the repo-wide ADR sweep run during architecture review (320 ADR files grep-swept; 11 read in full; no blocking conflict).

**Narrowed out after skim (no shared behavior, entity, or gate):** bin-setup-re-runs-on-every-dispatch-instead-of-onc, build-review-testquality-rubric-prompt-embeds-full, a-halted-feature-only-re-runs-when-a-human-clears-, as-built-review-receives-bounded-inputs-and-return, build-review-rubric-findings-arrive-as-typed-struc, generated-project-artifacts-delay-provider-startup, bin-teardown-run-a-project-supplied-teardown-hook-, prd-audit-has-no-criterion-key-for-an-over-scope-f, pipeline-commits-files-outside-the-active-plan-bef, condense-readme-relocate-docs, malformed-as-built-clause-forces-an-operator-decis, codex-auth-sandbox-permission-readiness-905, projects-cannot-add-portable-non-competing-build-r, out-of-plan-production-edits-reach-build-review-in, tests-leak-fixture-slugs-into-the-parked-feature-l, enable-single-repo-daemon-concurrency-un-clamp-the, daemon-park-does-not-stop-retries-inside-an-alread, live-boundary-guard-cannot-attribute-a-live-checko, infrastructure-exits-can-masquerade-as-test-sensit, grade-the-diff-for-security-defects-before-ship-vi, install-and-first-run-paths-give-misleading-or-mis, keep-containment-advisories-out-of-build-review-s-, no-release-time-smoke-or-eval-gate-releases-cut-wi, no-daemon-level-metrics-queue-depth-halts-and-gate, live-daemon-e2e-build-step-never-runs-a-real-agent, one-build-review-pass-clears-the-convergence-cap-s, one-rubric-s-rejected-contract-discards-the-whole-, park-and-unpark-resolve-the-repo-root-from-any-cwd, self-host-release-gate-bin-conduct-breaking-surfac, sweep-stale-vitest-run-temp-roots-at-global-setup-. The remaining story files share no keyword with credentials, build-auth, containment, or build_review fault routing.
