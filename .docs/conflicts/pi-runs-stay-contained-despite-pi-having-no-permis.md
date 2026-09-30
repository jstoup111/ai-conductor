# Conflict Check: Pi runs stay contained despite Pi having no permission model (#1886)

**Date:** 2026-09-29
**Stories checked:** `.docs/stories/pi-runs-stay-contained-despite-pi-having-no-permis.md` (Stories 1–7)
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml` `conflict_check.adr_corpus`)
**Result:** PASS. 0 blocking conflicts. 2 degrading items accepted: one overlap and one sequencing gap routed to follow-up intake.

## Corpus

**Stories.** All 516 files under `.docs/stories/` were keyword-swept (Pi, provider capability, readOnlyReview, nativeSchema, llm_providers, as-built, unknown-key, daemon-session/tmux, environment-claim, argv flags). These were opened and compared in both directions:
- `pi-as-a-build-provider.md`
- `pi-per-step-model-selection-via-wrapped-providers.md`
- `custom-build-review-rubrics-cannot-run-off-linux-o.md`
- `projects-cannot-add-portable-non-competing-build-r.md`
- `build-review-rubric-findings-arrive-as-typed-struc.md`
- `as-built-review-receives-bounded-inputs-and-return.md`
- `compose-launcher-honors-llm-provider-for-codex.md`
- `stop-refuting-blanket-environment-denial-claims-th.md`
- `config-keys-that-validate-but-have-no-consumer-inc.md`
- `destructive-git-prevention-is-absent-in-self-host.md`

**ADRs examined** (Decision sections read):
- adr-2026-09-24-built-in-provider-catalog-and-boot-discovery (D1–D18)
- adr-2026-09-10-portable-build-review-policy (D5.1–D5.5)
- adr-2026-08-24-one-dispatch-member-on-the-provider-contract
- adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope
- adr-2026-09-23-provider-admission-gate-and-daemon-scoped-availability
- adr-2026-09-20-operator-launched-sessions-retain-conductor-authority
- adr-2026-09-23-engine-git-guard-on-agent-path
- adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation
- adr-2026-08-17-structural-live-checkout-containment
- adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal
- adr-2026-09-28-skills-may-bundle-executable-helpers
- adr-2026-08-19-engine-stamped-rubric-judged-result-envelope
- adr-2026-08-13-engine-managed-build-review-rubric-branches
- adr-2026-07-03-reactive-model-fallback-ladder
- adr-2026-08-09-worktree-local-provider-scratch
- adr-2026-08-12-per-provider-live-smoke-legs
- adr-2026-06-30-sandbox-build-isolation
- adr-2026-07-08-main-checkout-leak-triage-and-write-fence
- adr-005-non-autonomy-and-read-only-governor

**Narrowed out.** About 307 ADRs matched only on generic terms and do not govern these behaviors. Examples: adr-014-otel-observability-exporter, adr-2026-06-29-per-project-memory-provider-selection, adr-2026-07-04-respawn-in-place-restart. None was excluded as superseded.

## Degrading: Pi read-only probe reports available while custom laps still refuse Pi

**Stories involved:** Story 2 (Pi read-only mode availability) vs custom-build-review-rubrics Story 5 (learn at startup that a provider cannot run custom review)
**Files:** `.docs/stories/pi-runs-stay-contained-despite-pi-having-no-permis.md` vs `.docs/stories/custom-build-review-rubrics-cannot-run-off-linux-o.md`
**Type:** overlap
**Severity:** degrading

**Description:** When an enabled custom rubric names pi, the daemon-start capability event can report Pi's read-only mode as `available`. Dispatch then refuses the member on `reviewPolicyCatalog`, which #1888 owns. Neither story is falsified: the probe reports read-only mode availability only, and Story 1's negative path keeps the `reviewPolicyCatalog` refusal. But the operator learns about the refusal at dispatch rather than at startup.

**Resolution options:**
1. Accept. The probe result concerns read-only mode only. #1888 turning on `reviewPolicyCatalog` closes the window.
2. Add a startup reason line noting the missing `reviewPolicyCatalog` to the capability event. This adds new event content outside the confirmed scope.

**Resolution:** Option 1, accepted as degrading. It is transient until #1888, and the dispatch-time refusal already names the capability and its owner.

## Degrading: Engine git guard reaches Claude and Codex but not Pi

**Parties:** adr-2026-09-23-engine-git-guard-on-agent-path D2 vs Story 6 (Pi subprocess env)
**Type:** sequencing (gap, not opposing text)
**Severity:** degrading

**Description:** The git guard ADR is approved and its spec is merged, but it is not built yet. It says "Every provider adapter's child-environment construction is the enforcement point", then scopes "This applies to Claude and Codex". Story 6 gives Pi its first child-env construction (daemon-session marker and tmux scrub) but does not prepend `.pipeline/bin`. So ordinary Pi build dispatches would bypass the destructive-git guard once it ships. Pi read-only review is unaffected: `git_read` admits only read-only subcommands.

**Resolution options:**
1. Route to a follow-up intake that extends the guard's PATH prepend to Pi's env seam once both features exist. #1886 stays unblocked.
2. Add the prepend to Story 6 and make #1886 `blocked_by` the git guard build.

**Resolution:** Option 1. It avoids chaining #1886 behind a second unbuilt spec. Filed as #2854 (blocked_by #1354 and #1886).

## Cleared near-misses

- `pi-as-a-build-provider` Story 2 refuses Pi by capability name (`selfHost`, `reviewPolicyCatalog`) and never names `readOnlyReview` or `nativeSchema`. Its custom-policy `reviewPolicyCatalog` refusal is preserved by Story 1's negative path.
- `pi-per-step-model-selection` Story 5 rejects non-catalog provider ids, not sub-keys. No story enumerates the exact `llm_providers.pi.*` sub-key set, so `trust_project_files` contradicts nothing. The consumer-registry declaration satisfies that story's Done When.
- No story pins Pi's argv as an exact list. The existing Pi argv criteria are "contains" checks.
- No story asserts that as-built review refuses a pi-only candidate set. The native-schema refusal story is provider-generic.
- portable-build-review-policy D5.5 requires "the provider's own mechanism, never a platform table". D17's `pi --help` probe is Pi's own mechanism. D5.2's "never read from project or operator configuration" holds because `trust_project_files` never applies to a review invocation (Story 1).
- engine-stamped-rubric-judged-result-envelope's no-repair-turn rule is compatible: Pi's argument-validation retry happens inside one invocation, and a missing `submit_result` fails the invocation (Story 4).
- operator-launched-sessions ADR: Story 6 relies on the existing daemon-session entry guard, unchanged.
- The self-host isolation and live-checkout containment ADRs apply only to `selfHost` providers. Pi declares none, and #2851 owns OS containment.
