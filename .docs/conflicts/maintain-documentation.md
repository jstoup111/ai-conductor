# Conflict Check: Maintain documentation

**Date:** 2026-07-25
**New stories:** `.docs/stories/maintain-documentation.md`
**Corpus scanned:** 237 story files, 35 specs, 118 prior conflict reports, current project
instructions, APPROVED ADRs, and the active README-relocation specification
**Result:** PASSED after operator-approved resolution; zero blocking conflicts remain and one
degrading sequencing overlap is accepted

## Resolved blocking conflicts

### Notable-only changelog policy versus release-on-every-PR

**Type:** contradiction / sequencing
**Confidence:** 99% (verified text, workflow, and self-host gate)

The operator selected notable-content-triggered releases. APPROVED
`adr-2026-07-25-notable-change-release-trigger` supersedes only the old non-empty
`[Unreleased]` requirement. Empty content now means a successful no-release merge; integrity and
breaking-change migration enforcement remain fail-closed. The accepted stories now cover both the
documentation judgment and release behavior.

### README-every-feature versus canonical destination ownership

**Type:** behavioral overlap / resource contention
**Confidence:** 98% (verified text)

The operator selected a repository-local refinement. This repository's configured skill decides
the canonical destination and updates README only when its landing-page contract changes. The
global consumer-project convention remains unchanged. The accepted stories state both sides.

## Accepted degrading conflict

### Active flat docs relocation versus approved purpose-based taxonomy

**Type:** overlap / sequencing
**Confidence:** 100% (both target layouts are explicit)

The operator accepted temporary churn: the active README-relocation feature may finish, this
implementation does not migrate existing human-facing docs, and the approved taxonomy governs new
placement plus the explicitly deferred final migration request. No in-flight artifacts or branches
are changed by this resolution.

## Clean pair findings

- **Custom-step ordering:** compatible with `ST-051-add-custom-steps`; insertion and state behavior
  are unchanged. Confidence 99%.
- **Phase-scoped `.docs` guard:** compatible; the SHIP skill writes no `.docs/` path. Confidence
  100%.
- **Finish-record and shipped-record:** compatible; finalization precedes both and changes no marker
  authority. Confidence 98%.
- **Migration blocks:** compatible; runnable migration blocks remain separate from the one-sentence
  changelog entry. Confidence 100%.
- **Repository-local discovery:** compatible with project-local skill resolution and client symlink
  conventions. Confidence 97%.

## Re-check verdict

All five conflict types were re-evaluated after the story and ADR amendments. Zero blocking
conflicts remain. Proceed to plan.
