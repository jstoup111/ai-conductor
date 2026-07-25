# Conflict Check: First-Class Codex Harness Skills and Guidance (#904)

**Date:** 2026-07-25
**New stories:** `.docs/stories/first-class-codex-harness-parity-904.md` (ST-904-1 through
ST-904-13)
**Comparison set:** all 238 story artifacts, all 37 specs, and all 118 prior conflict reports
**Result:** PASSED — zero blocking conflicts and zero degrading conflicts

## Method

The inventory was scanned across all five conflict types: contradiction, behavioral overlap,
state conflict, resource contention, and sequencing. Full-text and surface searches identified the
existing installer, bootstrap, skill-contract, provider-policy, provider-routing, self-host,
release-gate, and shared-document-contract stories that can interact with #904. Those pairs were
then read and reasoned through directly rather than treating shared keywords or files as conflicts.

## Pairs Examined

### 1. #904 skill installation vs built-in provider readiness #901

**Stories:** ST-904-1 through ST-904-4 vs
`builtin-provider-installation-readiness-901.md` ST-901-1 through ST-901-5

**Types checked:** contradiction, overlap, sequencing

**Finding:** **Compatible, 99% confidence** from direct story comparison. #901 requires every
normal installation to establish both built-in provider surfaces while readiness is evaluated only
for the selected required providers. #904 defines the correct Codex discovery outcome within that
already-required surface and does not change provider selection, missing-CLI warning behavior, or
execution routing. A missing external Codex CLI remains non-fatal to installation, while #904's
link/catalog checks remain deterministic filesystem checks.

### 2. Candidate-local prompts vs provider-aware model and fallback contracts #902/#927

**Stories:** ST-904-8 through ST-904-10 and ST-904-13 vs
`model-and-effort-resolution-provider-aware-902.md` and `per-step-provider-routing-927.md`

**Types checked:** contradiction, state conflict, sequencing

**Finding:** **Reinforcing, 99% confidence** from the approved stories, ADRs, and current candidate
loop. #902 resolves provider-native model/effort values per actual provider; #927 resolves
provider order, failure classification, sessions, and attribution per candidate. #904 adds the
prompt's explicit skill mention to that same per-candidate rule without changing any existing
setting, ordering, fallback trigger, session, retry, or attribution behavior. Unknown/custom
providers retain their accepted Claude-compatible policy and slash-form compatibility behavior.

### 3. Durable Codex guidance vs bootstrap and project-creation scaffolding

**Stories:** ST-904-5 and ST-904-6 vs `features/bootstrap/ST-026-project-scaffolding.md` and
`phase-9.2-registry-project-creation.md`

**Types checked:** behavioral overlap, state conflict, sequencing

**Finding:** **Compatible, 97% confidence** from direct acceptance-text comparison. Existing
bootstrap behavior preserves existing project files and fills missing onboarding gaps. #904 makes
Codex guidance one such missing gap and retains preservation/idempotency. The standalone `create`
command remains a minimal skeleton and does not absorb bootstrap; a later bootstrap may add missing
`AGENTS.md` guidance while preserving registry status and existing `CLAUDE.md` content.

### 4. New Codex link targets vs worktree-rooted global-install guard #363

**Stories:** ST-904-1 through ST-904-4 vs
`guard-bin-install-and-self-build-relink-against-wo.md`

**Types checked:** resource contention, sequencing, data integrity

**Finding:** **Reinforcing, 99% confidence** from direct story and ADR comparison. The worktree
guard refuses default/update mode before any global write; #904 does not weaken or bypass it. The
new current and legacy Codex skill locations join the global state that must remain unchanged on a
guard refusal. Read-only check remains available. Self-build relinking continues to invoke the
installer only at the durable main checkout.

### 5. Installer reconciliation vs RTK hook preservation and update flow

**Stories:** ST-904-1 through ST-904-4 vs `2026-07-12-rtk-hook-preservation.md` and
`port-self-update-flow.md`

**Types checked:** resource contention, partial failure, sequencing

**Finding:** **Compatible, 98% confidence** from direct story comparison. The operations share
`bin/install` but mutate disjoint operator state: skill discovery links versus Claude settings/RTK
hooks. #904's ownership-safe rules prohibit unrelated mutation and therefore reinforce hook
preservation. `bin/update` continues to call the supported migration/install path and does not
define a competing skill target.

### 6. Shared host scoping vs generated model and skill-pin integrity

**Stories:** ST-904-7, ST-904-8, and ST-904-13 vs `generated-model-table.md`,
`model-and-effort-resolution-provider-aware-902.md`, and the Fable rollout stories

**Types checked:** contradiction, behavioral overlap, resource contention

**Finding:** **Compatible, 99% confidence** from direct story comparison. Existing model stories
already define `SKILL.md` pins and standalone interactive rows as the Claude interactive path while
Codex owns a separate engine policy. #904 explicitly preserves those pins and integrity checks;
it scopes them instead of deleting them or treating them as Codex values. The generated model table
remains authoritative.

### 7. Shared-skill edits vs documentation-only delivery #933

**Stories:** ST-904-7, ST-904-8, and ST-904-13 vs `tdd-is-too-literal-933.md` Stories 4 and 5

**Types checked:** contradiction, overlap

**Finding:** **Compatible, 96% confidence** from direct story comparison. #904 changes executable
workflow contracts and their machine-enforced compatibility/integrity behavior; it is not an
ordinary documentation-only request. The #904 stories correctly contain no README or prose-update
acceptance obligations. Machine-consumed `HARNESS.md`, skill files, generated regions, and release
signals may be tested for functional contracts, while incidental wording/formatting remains
outside acceptance tests and plan tasks.

### 8. Direct Codex skills vs project skill overrides, hooks, and custom steps

**Stories:** ST-904-1, ST-904-9, and ST-904-11 vs
`features/config/ST-060-skill-replacement.md`, `ST-061-skill-hooks.md`, and
`ST-051-add-custom-steps.md`

**Types checked:** behavioral overlap, state conflict, sequencing

**Finding:** **Compatible, 94% confidence** from the stated scope. #904 guarantees the supported
built-in harness catalog and existing daemon-managed steps; it neither removes project overrides
and hooks nor promises new third-party/custom-step parity. Hardcoded lifecycle gates remain
authoritative when custom content is active. Any future expansion of candidate-local invocation to
arbitrary custom steps requires separate product scope rather than an inferred #904 behavior.

### 9. Codex daemon priority vs Claude self-host sandbox and #905/#906/#759 boundaries

**Stories:** ST-904-9 through ST-904-12 vs `harness-self-host-guardrails.md`, provider readiness
#901, and the approved #904 scope

**Types checked:** contradiction, sequencing, resource contention

**Finding:** **Compatible with explicit dependency boundary, 98% confidence.** #904 proves skill
discovery, provider-native dispatch, and lifecycle-gate behavior. It does not redefine provider
authentication, sandbox/approval readiness (#905), usage reporting (#906), or a persistent native
interactive launcher (#759). Those capabilities may gate a credentialed live environment but are
not circular prerequisites for #904's deterministic contracts. Legacy `bin/conduct` remains
untouched.

## State and Resource Review

- No new persistent state, lock, port, datastore, queue, or shared worktree resource is introduced.
- Current and legacy skill locations are reconciled only through ownership-proven links; foreign
  state is never claimed by the harness.
- Candidate prompts are immutable per attempt and regenerated for fallback, so no cross-provider
  prompt state is shared.
- Existing artifact gates remain the single authority for lifecycle advancement.

## Sequencing Review

- #927's candidate loop is already present on main and is the only runtime prerequisite.
- #905 and #906 can build independently because #904 does not modify their auth/sandbox or usage
  contracts.
- #759 remains the hand-off for native interactive session behavior.
- Historical July 23 Codex installer/bootstrap worktrees encode a superseded discovery location and
  are not dependencies or safe cherry-pick sources.

## Verdict

Conflict check passed clean. No stories, PRD, architecture, or ADR required amendment; no conflict
resolution was applied, no superseding ADR was created, and no review-required marker is needed.
Proceed to `/plan`.
