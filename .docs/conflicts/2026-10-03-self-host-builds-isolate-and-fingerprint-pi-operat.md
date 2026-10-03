# Conflict Check: Self-host builds isolate and fingerprint Pi operator state (#1887)

**Date:** 2026-10-03
**New stories:** `.docs/stories/self-host-builds-isolate-and-fingerprint-pi-operat.md` (Stories 1–4)
**ADR corpus:** repo_wide. Examined, for overlap with self-host isolation, the provider catalog,
the live boundary and scratch homes:
adr-2026-09-24-built-in-provider-catalog-and-boot-discovery (with this spec's D23–D26 amendment),
adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation,
adr-2026-08-09-worktree-local-provider-scratch, adr-2026-08-17-structural-live-checkout-containment,
adr-2026-07-07-daemon-owned-build-credential, adr-2026-06-30-sandbox-build-isolation,
adr-2026-08-04-live-tier-provisions-its-own-provider-home, and
adr-2026-09-23-engine-git-guard-on-agent-path. Narrowed out: the remaining ADRs that match only on
"self-host" release, version or PR-timing gates, which have no subject overlap with
provider-home isolation.
**Result:** 3 blocking contradictions, all resolved by in-place story replacement; 0 degrading.
Re-check after resolution: clean.

## Conflict: Pi selfHost refusal story contradicts Pi declaring selfHost

**Stories involved:** pi-as-a-build-provider (TI-2 negative path) vs Story 1 (TI-1)
**Files:** [.docs/stories/pi-as-a-build-provider.md] vs [.docs/stories/self-host-builds-isolate-and-fingerprint-pi-operat.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The shipped story says: "Given pi is selected for a path that requires the selfHost
capability, when that path is reached, then it fails before spawning with an error naming provider
pi, capability selfHost, and the owning intake." Story 1 says: "Given the pi catalog descriptor,
when `supportsProviderCapability` is queried for `selfHost`, then it returns true". Both cannot
hold.

**Resolution Options:**
1. Re-point the shipped criterion at a capability Pi still lacks and that has an owning intake,
   `interactiveLaunch` (#1007). It still proves the refusal-by-name behavior.
2. Delete the criterion; the generic absent-flag criterion beside it still covers refusal.

**Recommendation and resolution:** Option 1. Replaced in place with "Given pi is selected for a
path that requires the interactiveLaunch capability, when that path is reached, then it fails
before spawning with an error naming provider pi, capability interactiveLaunch, and the owning
intake."

## Conflict: Pi read-only review story lists selfHost as still false

**Stories involved:** pi-runs-stay-contained-despite-pi-having-no-permis Story 1 vs Story 1 (TI-1)
**Files:** [.docs/stories/pi-runs-stay-contained-despite-pi-having-no-permis.md] vs [.docs/stories/self-host-builds-isolate-and-fingerprint-pi-operat.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The shipped story says "…then it returns true, while `selfHost`,
`reviewPolicyCatalog`, `writeFence`, `readiness` and `interactiveLaunch` still return false."

**Resolution:** `selfHost` was removed from that list in place. The other four flags are
unchanged.

## Conflict: Pi cost story lists selfHost as still false

**Stories involved:** pi-runs-report-token-usage-and-cost-into-harness-t (TI cost capability) vs Story 1 (TI-1)
**Files:** [.docs/stories/pi-runs-report-token-usage-and-cost-into-harness-t.md] vs [.docs/stories/self-host-builds-isolate-and-fingerprint-pi-operat.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The story says "…then it returns true, while `selfHost`, `reviewPolicyCatalog`,
`writeFence`, `readiness`, and `interactiveLaunch` still return false." That feature (#1889) is
still building. Its assertion is true until #1887 ships.

**Resolution:** `selfHost` was removed from that list in place. Sequencing: the companion story
PR merges only after #1889 ships, so #1889's in-flight build is never graded against the
post-#1887 wording. #1887's BUILD updates the corresponding provider-catalog test assertion that
#1889 adds.

## Delivery of the resolutions

The land gate's stem check refuses foreign-stem story edits on this spec branch. The three in-place
replacements therefore ship as a companion main-based PR that accompanies this spec PR. Merge it
after #1889 ships and before or with this spec.

## Pairs examined and found compatible

- harness-skills-and-context-files-reach-pi-sessions (Pi resolves skills under
  `$PI_CODING_AGENT_DIR/skills`) vs Story 1: the isolated home carries the worktree `skills/`, so
  resolution still succeeds. Both hold in both directions.
- isolate-daemon-build-auth-from-operator-oauth (Claude sandbox `childEnv()` carries
  `CLAUDE_CODE_OAUTH_TOKEN`) vs Story 1's scrub: the scrub applies to the provider-home isolation
  kind (codex, pi), not the Claude sandbox path. Compatible.
- interrupted-self-host-runs-leak-provider-homes-unt (lease contents, sweep rules) vs Story 3:
  Story 3 reuses the same lifecycle unchanged for pi. Compatible.
- enable-single-repo-daemon-concurrency-un-clamp-the ("provider-state drift … halt remains
  unconditional") vs Story 2's contained-dispatch negative: they agree.
- pi-as-a-build-provider ("claude and codex … behavior is unchanged") vs Story 4 parity criteria:
  they agree. Story 4 adds only the scrub of the two `PI_*` variables to the codex child
  environment, which no codex story constrains.
- codex-safety-and-self-host-parity-907 (Codex `.agents/skills` discovery) vs Story 4: preserved.
- live-boundary-halts-self-host-builds-when-the-oper (containment relaxes only the live-checkout
  surface) vs Story 2: they agree.
- adr-2026-07-26 §3 vs Story 1: compliant. Only the selected credential enters the home.
- adr-2026-07-07-daemon-owned-build-credential vs Story 4: the daemon token remains a Claude-only
  credential, and codex already skips it.

No oscillating pairs: each resolved pair was checked in both directions after replacement.
