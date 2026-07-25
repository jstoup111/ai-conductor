# Architecture Review: Maintain documentation

**Date:** 2026-07-25
**Stories reviewed:** None; technical-track intent and approved architecture diagrams reviewed before stories
**Mode:** Lightweight (tier M)
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** PASS. The workflow uses an existing repository-local skill path,
  custom-step registry, TypeScript completion gate, and finish skill. No package, service, or
  infrastructure is added. Confidence 98% (verified source).
- **Prerequisites:** PASS. `.agents/skills` is a supported repository skill location; the Claude
  path can symlink to the same canonical directory. Confidence 97% (verified repository install
  patterns and current Codex manual).
- **Integration surface:** BOUNDED. Changes cross configuration validation, completion gating,
  CLI dispatch, the finish skill, repository configuration, and the new local skill. Each has an
  existing production seam. Confidence 95% (verified source).
- **Data implications:** PASS. Only committed documentation and gitignored `.pipeline/` evidence;
  no persistent schema or migration.
- **Performance:** PASS. One exact-file `stat` per configured custom-gate check and one conditional
  changelog read during PR finish.
- **Worktree isolation:** PASS. Completion evidence is under each feature worktree's `.pipeline/`;
  documentation commits remain on that feature branch.

## Alignment

- **Deterministic where possible:** PASS. Engine code verifies completion evidence and a CLI
  primitive performs exact PR-link replacement; the LLM retains only documentation judgment.
- **Repository scope:** PASS. The custom step exists only in this repository's configuration.
  Generic completion behavior is opt-in; finish finalization is a no-op without the exact token.
- **Current custom-step pattern:** PASS. Ordering and dispatch reuse `buildStepRegistry` and the
  existing loop gate. No first-class `StepName` is added.
- **Existing completion decisions:** PASS. Built-in predicates remain authoritative and unchanged;
  the new contract applies only to configured custom steps.
- **Phase-scoped `.docs` guard:** PASS. The custom skill may read `.docs/` but writes no `.docs/`
  path. Human-facing `README.md`, `docs/`, and `CHANGELOG.md` remain writable during SHIP.
- **Finish-record decisions:** PASS. PR-link finalization occurs before shipped-record and
  finish-record. It does not write `.pipeline/finish-choice` or weaken existing push evidence.
- **Diagram accuracy:** PASS. The approved component and sequence diagrams represent the custom
  gate, transient evidence, conditional finalization, and no-op behavior.

## Wiring Surface

| New or changed production surface | Production caller |
|---|---|
| `StepConfig.completion_artifact` validation | `validateConfig` while loading `.ai-conductor/config.yml` |
| Config-aware custom completion check | Conductor post-dispatch gate and retry loop through `checkStepCompletion` |
| `conduct-ts finalize-changelog-pr` | `finish` skill after `/pr` returns a URL and before shipped-record |
| `.agents/skills/maintain-documentation/SKILL.md` | Custom step resolved from this repository's `.ai-conductor/config.yml` |
| `.claude/skills/maintain-documentation` symlink | Direct Claude Code skill discovery; points to the canonical `.agents` skill |
| `.pipeline/maintain-documentation-review.md` | Written on every skill invocation for operator evidence |
| `.pipeline/maintain-documentation-pass` | Written only on PASS; consumed by configured custom completion gate |
| `{{IMPLEMENTATION_PR}}` | Authored by the documentation skill; consumed by `finalize-changelog-pr` |

**Early overlap scan:** The two new repository-local skill paths have no overlap with unmerged
branches. The broad engine scan reports widespread hub-file overlap from cumulative stale spec
branches; direct three-dot inspection of the semantically adjacent README and skill-cleanup
branches shows only their `.docs/` specification artifacts. Advisory; no blocker found.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A stale pass marker advances a later attempt | Technical | Low | High | Require attempt/session freshness; fail closed without a floor |
| Finish creates a PR but PR-link finalization fails | Integration | Low | High | Exact-token CLI is atomic; STOP before shipped-record and finish-record |
| Custom gate changes behavior in consumer projects | Integration | Low | High | Custom-only key; no configured artifact preserves current behavior |
| Documentation skill edits historical SDLC artifacts | Technical | Low | High | Hard read-only `.docs/` contract in the skill; existing phase guard adds defense in depth |
| Existing documentation remains inconsistent with the new taxonomy | Knowledge | Certain | Medium | Explicitly deferred until operator approves the completed skill and requests migration |

## ADRs Created

- `adr-2026-07-25-custom-step-completion-artifacts` — APPROVED by the operator on 2026-07-25
- `adr-2026-07-25-changelog-pr-link-finalization` — APPROVED by the operator on 2026-07-25

## Conditions

None. The operator approved `adr-2026-07-25-notable-change-release-trigger` on 2026-07-25.

## Amendment: Notable-content release trigger

- **Feasibility:** PASS. The existing workflow already parses `[Unreleased]`; the failing empty
  branch becomes a successful no-op. The self-host gate already composes independent integrity,
  changelog, and migration decisions, so only the non-empty sub-gate is retired. Confidence 99%
  (verified source).
- **Alignment:** PASS. Changelog content becomes the release trigger. Integrity,
  migration enforcement, VERSION approval, no-auto-merge, and consumer-project behavior remain
  unchanged.
- **Wiring additions:** `.github/workflows/release.yml` consumes the empty/non-empty result for all
  mutation steps; `runReleaseArtifactGate` continues from integrity directly to breaking-surface
  migration validation; the configured documentation step supplies the prior notable-change
  judgment.
- **Risk:** an incorrectly omitted entry defers a release. Impact Medium; mitigation is the gating
  skill plus PR review, with deterministic linting deferred to issue #942.
