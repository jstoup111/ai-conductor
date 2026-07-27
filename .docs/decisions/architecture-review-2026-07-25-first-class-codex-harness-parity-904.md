# Architecture Review: First-Class Codex Harness Skills and Guidance (#904)

**Date:** 2026-07-25
**Input reviewed:** Approved PRD FR-1 through FR-13; operator-approved component and sequence
diagrams including the candidate-local correction; active installer, bootstrap, skill catalog,
provider candidate execution, and step runner
**Complexity:** Medium (lightweight review)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

The feature is feasible with the current Bash, Markdown, and TypeScript stack. It needs no new
package, service, datastore, schema migration, external account, port, or shared worktree runtime.
Its breadth is primarily a deterministic content-and-test audit; the runtime change is one narrow
adapter within an existing execution boundary.

Verified implementation seams:

- `bin/install` already centralizes install, update, check, and uninstall behavior for both built-in
  hosts. Its Codex target is currently `~/.codex/skills`, so the active mapping and lifecycle tests
  need correction plus ownership-safe migration handling.
- Bootstrap already creates or preserves both `CLAUDE.md` and `AGENTS.md`; only the Codex harness
  reference and its tests are stale.
- `STEP_PROMPTS` contains the complete explicit slash-form lifecycle mapping, including arguments
  such as `--as-built`. This provides an enumerable source for a typed semantic invocation map.
- `executeProviderCandidates` already resolves model, effort, runtime, and session state inside its
  candidate loop, but passes one static `options.prompt` to all candidates. An optional
  candidate-local options factory fits this existing loop without redesigning routing or providers.
- `test_harness_integrity.sh` already enforces skill frontmatter, references, and model-table
  consistency. Codex compatibility checks can extend that safety net while preserving its current
  Claude and engine-policy contracts.

The full catalog audit is material but mechanical and bounded. There is no evidence that #904
requires a plugin system, generated skill variants, provider-runtime redesign, or work on legacy
`bin/conduct`.

## Alignment

The design extends the approved
`adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` boundary: provider-native
choices that differ per attempt are resolved inside the candidate loop. It does not change
selected-first/configured-order fallback, classification precedence, model/effort policy,
step-and-provider-local sessions, retries, or actual-provider attribution.

The chosen one-source model matches existing repository ownership: `skills/` and `HARNESS.md`
remain canonical, while the installer and bootstrap expose host-native views. A plugin would solve
distribution, not built-in daemon dispatch or shared-contract correctness, and would add an
unnecessary independent lifecycle. Generated provider trees would introduce a second drift problem.

The corrected component and sequence diagrams place prompt adaptation immediately before each
candidate invocation. Both Mermaid diagrams render successfully. System-context, container, and
ERD views remain accurate because the feature adds no external system, deployable unit, or data
relationship.

The approved self-host release-gate architecture treats skill-link target changes and
`HARNESS.md` changes as release-sensitive. The implementation plan must therefore include the
appropriate Unreleased changelog, migration guidance, and version-signal evidence rather than
treating the path correction as an invisible internal change.

## Wiring Surface

| Production surface | Design-time production wiring |
|---|---|
| Codex user-scope mapping and legacy-link reconciler | Called by active `bin/install` install/update, check, and uninstall modes for every supported skill and `HARNESS.md` |
| Durable Codex guidance reference | Emitted or appended by the bootstrap workflow through `templates/AGENTS.md.template`, while preserving existing content |
| Provider-native skill invocation resolver | Called by the scalar `DefaultStepRunner` path and by provider-aware candidate option construction for every dispatched lifecycle step |
| Candidate-local invocation-options factory | Accepted by `executeProviderCandidates` and called inside its loop immediately before `invokeProviderCandidate`; omitted callers retain current static options |
| Shared skill compatibility contract | Consumed by every installed/direct skill invocation and enforced by harness-integrity plus focused provider-contract tests |
| Unsupported-capability diagnostic contract | Emitted by the applicable shared skill before provider-incompatible work; observed by the existing incomplete-step/artifact gate |
| Installation and migration documentation | Linked from README/provider setup surfaces and included in the Unreleased release notes/migration path |

Candidate implementation paths include `bin/install`, `skills/bootstrap/SKILL.md`,
`templates/AGENTS.md.template`, `HARNESS.md`, `skills/*/SKILL.md`,
`src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/provider-execution.ts`, a narrow
new invocation-resolver module, and their focused shell/TypeScript acceptance tests. Legacy
`bin/conduct` is explicitly excluded.

## Early Overlap Scan

The required advisory scan reported broad historical overlap across nearly every listed central
file. Direct inspection narrows the actionable signal:

- The live #905 branch currently contains only its track artifact and has no production-file
  overlap with #904. Auth, sandbox, approval, and credential readiness remain separate.
- No active #906 implementation branch was visible. Usage accounting remains outside #904.
- Two July 23 Codex skill/bootstrap precursor worktrees touch the installer, bootstrap, templates,
  docs, and tests, but are based on older code and encode the superseded `~/.codex/skills` target.
  Main already contains evolved portions of that work. They are evidence, not safe cherry-pick
  dependencies.

Central-file merge-conflict exposure remains real if neighboring branches advance. The plan should
use narrow seam-oriented commits and rebase at the sanctioned finish boundary.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Codex `$skill` syntax is reused for a Claude fallback, or vice versa | Integration | Medium | High | Resolve prompt inside every candidate attempt; test both fallback directions and scalar execution |
| Migration deletes or overwrites operator-owned skill content | Data | Low | High | Act only on exact harness-owned symlink targets; preserve/report foreign links, files, and directories; add negative tests |
| Broad content edits weaken existing Claude gates or model policy | Technical | Medium | High | Preserve frontmatter/model pins and current integrity checks; scope host-specific prose instead of deleting contracts |
| Static compatibility checks produce false confidence | Knowledge | Medium | Medium | Combine focused static rules with actual Codex discovery/load and representative execution evidence |
| Concurrent work conflicts in central installer/docs/runner files | Integration | High | Medium | Narrow commits, re-check live overlap before planning/landing, and finish-time rebase |
| A generalized capability system is introduced without evidence | Technical | Low | Medium | Keep unsupported-capability handling at the skill boundary; require a new ADR if repeated runtime evidence justifies a registry |

## ADRs Created

- `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` — APPROVED; chooses one canonical
  catalog, documented host discovery surfaces, ownership-safe migration, durable guidance, and
  candidate-local daemon prompt adaptation.

## Conditions

1. **Satisfied:** The operator approved the ADR and corrected candidate-local diagram flow on
   2026-07-25.
2. Every provider-aware attempt, including fallbacks, must resolve invocation syntax for the actual
   candidate immediately before invocation; a single pre-resolved prompt is non-conforming.
3. Legacy migration and uninstall may mutate only provably harness-owned links. User-owned files,
   directories, and foreign links must survive unchanged.
4. The shared-skill audit must retain common gates and existing Claude/model-policy integrity while
   explicitly scoping host-only invocation, model, tool, delegation, and interactive instructions.
5. Acceptance coverage must enumerate every Codex-eligible daemon step, direct Codex discovery,
   idempotent installation/update, both fallback directions, unsupported capability behavior, and
   accepted Claude regressions.
6. No implementation or test change may target legacy `bin/conduct`; #905, #906, and #759 remain
   separate hand-offs.
7. The plan must include release/migration documentation and account for overlap in central files.

## Blocking Issues

None. The ADR and corrected diagrams are approved, and no unconfirmed load-bearing assumption
remains.
