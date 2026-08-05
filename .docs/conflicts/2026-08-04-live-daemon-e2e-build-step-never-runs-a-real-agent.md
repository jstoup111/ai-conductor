# Conflict Report: Live daemon E2E build step never runs a real agent

**Date:** 2026-08-04
**Feature:** live-daemon-e2e-build-step-never-runs-a-real-agent (jstoup111/ai-conductor#1311)
**Stories checked:** 5 new, against all accepted stories in `.docs/stories/`
**Result:** PASSED — 0 blocking outstanding (4 found and resolved), 4 degrading (all resolved)

## Scope of the scan

All five conflict types (contradiction, behavioral overlap, state conflict, resource
contention, sequencing) were evaluated pairwise across the five new stories and against every
accepted story reaching a contended surface. Story files read in full:
`daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md`,
`no-release-time-smoke-or-eval-gate-releases-cut-wi.md`, `model-availability-fallback-ladder.md`,
`build-auth-token-check-and-classify.md`, `isolate-daemon-build-auth-from-operator-oauth.md`,
`live-boundary-halts-self-host-builds-when-the-oper.md`,
`guard-bin-install-and-self-build-relink-against-wo.md`, `per-feature-token-accounting.md`,
`harness-daemon-profile.md`, `rate-limit-wait-signal.md`, `sandbox-auth-expiry-park.md`,
`codex-safety-and-self-host-parity-907.md`, `custom-step-skill-identity-dispatch.md` (DRAFT).
Targeted sections: `harness-self-host-guardrails.md`, `maintain-documentation.md`,
`parallel-validation-phase-fan-out-manual-test-prd-.md`,
`ci-needs-a-daemon-end-to-end-smoke-step-drive-a-1-.md`, `retry-as-escalation.md`,
`most-conductor-halts-carry-no-class-sidecar-so-the.md`, `retry-classify-rerun-vs-route.md`,
`builtin-provider-installation-readiness-901.md`.

Three of the four blocking conflicts below (C2, C3, C4) were resolved by changing a DECIDE
decision rather than by weakening a story: `adr-2026-08-04-live-tier-provisions-its-own-provider-home`
now selects the copy-semantics `provisionProviderHome` instead of the symlink-semantics
`provisionSandboxBuildEnv`.

---

## Conflict 1: A preflight failure would convert an advisory skip into a red run

**Stories involved:** ST-1124-5 "Missing credentials skip when advisory and fail when gating"
vs new Story 2 "A missing step command fails before any spend"
**Files:** `.docs/stories/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md:160-167` and
`.docs/stories/no-release-time-smoke-or-eval-gate-releases-cut-wi.md:80-83,98-100` vs
`.docs/stories/live-daemon-e2e-build-step-never-runs-a-real-agent.md` (Stories 1-2)
**Type:** sequencing
**Severity:** blocking → **resolved**

**Description.** The live file gates at `daemon-e2e-live.smoke.test.ts:210` with
`describe.skipIf(!shouldRun)`, where `shouldRun` requires the `claude` binary and
`CLAUDE_CODE_OAUTH_TOKEN` (`:103-105`). "Fails before any dispatch" invites module-scope
provisioning and preflight, which execute *before* `skipIf` is evaluated. An uncredentialed
`npm run smoke` — exactly the advisory case #1259's Story 2 specifies — would then turn red, and
in #1259's gate mode that reads as a genuine smoke regression rather than an honest skip.

**Resolution.** Ordering is now an explicit acceptance criterion, not an implementation
accident. Story 1 requires capability and credential gating to be evaluated first, with
provisioning and the preflight running *inside* the selected case only; Story 2 requires an
uncredentialed advisory run to skip without either ever executing. Story 2 also requires a
provisioning or preflight failure to be reported as `failed`, never as an unmet capability, so
#1259's ledger classifies it correctly.

---

## Conflict 2: Config-declared custom steps are dispatched but are not in the registry

**Stories involved:** `maintain-documentation.md:18-19,27-28` (this repository's required
`rebase → maintain-documentation → finish` tail) vs new Story 3 and Story 5
**Files:** `src/conductor/src/engine/step-runners.ts:540-548`, `.ai-conductor/config.yml:114-125`
**Type:** contradiction and behavioral overlap
**Severity:** blocking → **resolved**

**Description.** Verified at this HEAD: a step absent from `STEP_SKILL_INVOCATIONS` falls back
to `prompt = \`/${step}\`` — the raw state key (`step-runners.ts:546-548`). This repository
configures two such steps, `maintain-documentation` and `release-disposition`, whose skills live
under `.agents/skills/…` (`config.yml:114-125`). Two consequences: Story 5's "the central
step-to-skill registry is the single enumeration source" is **overclaimed**, because
config-declared custom and `parallel[].skill` branches are enumerated in `config.ts`, not in
`skill-invocation.ts`; and Story 3's classification would convert whatever those steps do today
into a hard failure. `custom-step-skill-identity-dispatch.md:3` is **`Status: DRAFT`** — its
negative path is precisely this defect, and it is not accepted work.

**Resolution.** Two changes, both narrowing a claim rather than widening the build.

1. **Story 5's guarantee is restated** as covering every command rendered through
   `renderSkillInvocation` from `STEP_SKILL_INVOCATIONS`, with a new negative-path criterion
   requiring config-declared custom and parallel-branch steps to be recorded as a known
   non-covered surface. The registry-derived preflight is not claimed to cover them.
2. **Story 3 gains a blocking pre-verification.** Before the classification lands, whether this
   repository's own custom steps currently resolve must be established empirically (plan Task
   14a). If they resolve, nothing changes. If they do not, that is a pre-existing latent defect
   this feature would merely make visible — and the classification must not land until it is
   fixed or explicitly scoped, because reddening this repository's own SHIP tail is not an
   acceptable side effect of a test fix. This is carried as review condition C-6.

---

## Conflict 3: Symlinking `skills/` from the live checkout is a write-through path

**Stories involved:** `live-boundary-halts-self-host-builds-when-the-oper.md:58-62` vs new
Story 1
**Files:** `src/conductor/src/engine/self-host/provider-home.ts:145-151` (the in-repo
counter-evidence), `sandbox-build-env.ts:125,176-186` (symlink), `CLAUDE.md` Daemon Operations
Safety §5
**Type:** state conflict / resource contention
**Severity:** blocking → **resolved**

**Description.** The originally chosen primitive, `provisionSandboxBuildEnv`, **symlinks**
`<root>/skills` into the throwaway home. `provider-home.ts:145-151` records why that is unsafe
for a home built from a checkout someone else is using: "a live link lets provider-owned
warmup/init writes … land back inside the git-tracked worktree through the link, defeating the
throwaway home's isolation." On this repository specifically, a local live-smoke run rooted at
the operator's live checkout could leave an untracked artifact there, and
`live-boundary-halts-self-host-builds-when-the-oper.md:58-62` halts a concurrent self-host build
on exactly that — the incident class `CLAUDE.md` §5 documents.

**Resolution.** The ADR's chosen primitive changed to `provisionProviderHome`, which **copies**
the asset (`provider-home.ts:151`) and, for Codex, links `.agents/skills` into the copy rather
than the worktree (`:166-171`, "so this view can't become a second write-through path"). Story 1
gains an acceptance criterion that after the run the checkout under test is unchanged
**including untracked paths**, not merely that the home was removed.

---

## Conflict 4: The rejected alternative was ambient-state dependence, which the chosen primitive reintroduced

**Stories involved:** `codex-safety-and-self-host-parity-907.md:516-519` (FR-15 NP-1 — personal
settings and global skill links are neither inherited nor modified) vs new Story 1
**Files:** `sandbox-build-env.ts:201-210,233-237,260-297` (`provisionTrustState` reads the
operator's live `~/.claude.json`)
**Type:** contradiction
**Severity:** blocking → **resolved**

**Description.** The ADR rejected "point the fixture at the operator's real `~/.claude`" because
"it makes the test's result depend on ambient machine state, and in CI there is nothing to point
at" — and then selected a primitive that reads the operator's live state file to propagate
workspace trust. In CI that file does not exist, so the tier would provision an untrusted home,
which `sandbox-build-env.ts:19-28` records as having previously "wedged on denied tools" — a
second, independent way for Story 1's "genuine agent turn" criterion to fail, indistinguishable
in the output from the failure being fixed.

**Resolution.** Resolved by the same primitive change as Conflict 3.
`provisionProviderHome` reads no operator state file at all: it creates a temp dir, copies
`skills/`, prunes operator-only skills, and sets one environment variable. No `settings.json`
copy, no `.claude.json`, no hook installation. Story 1 gains a criterion that the tier passes
with **no operator state file present**, which is the CI condition, and the architecture review
records the trust question as verified-by-observation (the same failing run's `build_review`
dispatched successfully against an equally trust-free ambient environment) rather than inferred.

---

## Conflict 5: The credential requirement contradicts the provider-neutral stripping contract

**Stories involved:** `codex-safety-and-self-host-parity-907.md:252-268` (FR-8 HP-1/NP-1) vs new
Story 1
**Files:** `provider-home.ts:100-108` (`childEnv()` deletes `CLAUDE_CODE_OAUTH_TOKEN`) vs
`sandbox-build-env.ts:145-147` (re-injects it)
**Type:** contradiction
**Severity:** degrading — **resolved**

**Description.** New Story 1 requires that "the credential still reaches the dispatched
process". `provisionProviderHome`'s `childEnv()` deliberately deletes
`CLAUDE_CODE_OAUTH_TOKEN` — "never inherit … Claude's ambient credential token" — and FR-8
requires that deletion. Taken together with the Conflict 3 resolution, Story 1 as first worded
was unsatisfiable.

**Resolution.** The distinction is *inheriting* an ambient credential versus a caller
*explicitly supplying* one. The fixture composes its dispatch env as the home's `childEnv()`
plus a credential it passes deliberately, so the production stripping contract is not weakened —
nothing ambient leaks in, and FR-8's guarantee about the *home* is untouched. Story 1 is
reworded to scope the credential criterion to explicit supply, with a companion negative-path
criterion that no credential is inherited implicitly and that a non-Claude leg receives its
credential through `prepareSelfHostAuth`.

---

## Conflict 6: The new failure class has no retry, escalation, or HALT-class contract

**Stories involved:** `build-auth-token-check-and-classify.md:133-140` (a deterministic
environmental failure takes "zero retry attempts and zero model/effort escalations"),
`retry-as-escalation.md:22-38` (the ordinary ladder escalates effort at attempt 2 and model tier
at attempt 3), `most-conductor-halts-carry-no-class-sidecar-so-the.md:22-28,32` (every HALT
carries `needs-human` or `mechanical`; a missing class is rejected) vs new Story 3
**Type:** behavioral overlap (missing state contract)
**Severity:** degrading — **resolved**

**Description.** Story 3 made the result unsuccessful and stopped there. Downstream, an ordinary
unsuccessful result enters the retry-as-escalation ladder, so an unresolved command would burn
attempts and escalate model tier — spending more money on a fault no retry can fix. The
established precedent for deterministic environmental failures is the opposite.

**Resolution.** Story 3 gains criteria: an unresolved-command result consumes no retry attempt,
triggers no effort or model escalation and no ladder walk, and any HALT it produces carries an
explicit class — `mechanical`, since re-provisioning fixes it. Conflict 7 of the earlier scan
(candidate advancement) is subsumed here: verified at `provider-execution.ts:237-242,280-289`,
the new reason matches neither `hasRecoveryPrecedence` nor the candidate-advancement predicate,
so it changes no accepted story's provider-fallback routing.

---

## Conflict 7: "Zero tokens were spent" is indistinguishable from "unmetered"

**Stories involved:** `per-feature-token-accounting.md:26-31` (unparsed usage is flagged
`unmetered`, "never silently treated as zero-cost") and ST-1124-2's cap assertion
(`daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md:82-88`) vs new Story 2
**Files:** `daemon-e2e-live.smoke.test.ts:62-64` (the meter sums `tokenUsage?.input ?? 0`),
`claude-provider.ts:438-458`
**Type:** state conflict
**Severity:** degrading — **resolved**

**Description.** Story 2 asserted "zero tokens were spent" via the meter. But the meter reads an
absent `tokenUsage` as exactly zero, and Story 3's own negative path establishes that the
failing envelope reports no usage at all — the precise branch where `tokenUsage` is left
undefined. So the assertion could pass on a run that did dispatch. The same gap silently weakens
ST-1124-2's token-cap assertion, which can pass on unmetered spend.

**Resolution.** Story 2's criterion is restated as "no provider invocation occurred", backed by
a dispatch counter rather than a token total, and Story 2 gains a criterion that the meter
tracks unmetered results separately so the cap assertion cannot pass on unattributed spend.

---

## Conflict 8: Two unsynchronized answers to "does this command resolve?"

**Stories involved:** `harness-self-host-guardrails.md:134-168` (TR-4 exists so a self-build
"never HALTs on `Unknown command /`", via `bin/install` / `ensureInstallFresh`) vs new Story 1's
prohibition on invoking `bin/install` and
`adr-2026-08-04-unresolved-step-command-fails-by-name`'s rejection of extending
`install-freshness.ts`
**Type:** behavioral overlap
**Severity:** degrading — **resolved**

**Description.** Two resolution checks now answer the same question on different surfaces, with
no story stating which owns which.

**Resolution.** The split is made explicit rather than removed, because the surfaces genuinely
differ: `install-freshness` owns the operator's global catalog at daemon entry; the new preflight
owns the run's own provisioned home. Story 5 gains a criterion recording that neither is
expected to cover the other's surface, and TR-4's amendment (`:5-9`, superseded for self-host
runs only, non-self-host behavior unchanged) is unaffected.

---

## Surfaces checked and found clean

- **The workflow's trigger and gate contract.** No trigger is added and no `ci-gate` dependency
  is created; ST-1124-4 (`:141-152`) and the reusable-call interface #1259 requires
  (`:200-203,225-227` — `require_credentials`, `secrets: inherit`) are unchanged. #1259 being
  accepted-but-unimplemented is a sequencing dependency, not a conflict.
- **The outcome-vs-script assertion rule.** New Story 4 re-affirms
  `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts`; no contradiction with ST-1124-1's
  prohibition on asserting exact provider-call counts or byte-exact commit bodies.
- **Shared diagnostics.** New Story 4 preserves `dumpPipelineDiagnostics` and forbids a second
  copy, consistent with ST-1124-3.
- **Provider classification precedence.** `claude-provider.ts:664-676` — every existing class
  except `sessionLimit`/`outOfCredits` is gated on `exitCode !== 0`; the new class is exit-0 and
  conjunction-gated, so it cross-triggers nothing in `sandbox-auth-expiry-park.md:44-53`,
  `model-availability-fallback-ladder.md:40-51`, or `rate-limit-wait-signal.md:60-71`.
- **`isolate-daemon-build-auth-from-operator-oauth` TR-2** (zero reads of
  `<globalConfigDir>/.credentials.json`): the tier reads no credentials file, only env.
- **`guard-bin-install-and-self-build-relink-against-wo` TR-1/TR-2:** the tier's absolute "no
  `bin/install`" is strictly stronger than the worktree-root guard.
- **`harness-daemon-profile` TR-1/TR-2/TR-3:** the workflow runs `npm ci` and `npm run build`
  directly; no overlap with `bin/setup` or the version gate.
- **`ci-needs-a-daemon-end-to-end-smoke-step-drive-a-1-.md` (#630):** the deterministic tier's
  fixture files and shared diagnostics are untouched.
- **`parallel-validation-phase-fan-out-…`:** group branches dispatch through
  `STEP_SKILL_INVOCATIONS[request.step]` (`step-runners.ts:861-862`), so registry-derived
  coverage applies; config-declared `parallel[].skill` overrides are folded into Conflict 2.
