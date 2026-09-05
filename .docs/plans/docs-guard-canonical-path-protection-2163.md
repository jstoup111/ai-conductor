# Implementation Plan: Docs guard canonical path protection

**Date:** 2026-09-05
**Source-Ref:** jstoup111/ai-conductor#2163
**Stories:** .docs/stories/docs-guard-canonical-path-protection-2163.md
**Conflict check:** S exemption; no blocking conflicts identified.

## Technical Approach

Change DOCS_GUARD_HOOK in session-hook-assets.ts, the sole source of hooks/claude/docs-guard.sh. Use Node already required by the embedded payload parser for path classification; do not invoke the engine bundle or introduce a realpath binary dependency. Preserve the marker-absent exit before stdin and the existing bounded payload read. The path decision must be independent of an exact spelling of PWD.

Produce two candidate interpretations: the normalized requested path, and the filesystem-resolved destination. Resolve the actual cwd to the physical project root. Treat logical PWD as another root spelling only after verifying it resolves to that root; an unrelated PWD is not an authority to grant an exemption. Recognize alternate project-root aliases by resolving prefixes of the requested absolute path: once a prefix resolves to the physical root, retain its remaining requested suffix as the lexical root-relative candidate before following links inside that suffix. Do not rely only on PWD/physical string-prefix matching or the final realpath. For example, an unrelated alternate-root alias followed by `.docs/plans/outward-link` remains a requested protected path even when that inner link resolves outside the project. Final-destination resolution is a separate interpretation and cannot erase this recorded requested-path protection.

Path resolution must preserve filesystem symlink/traversal semantics: do not collapse `link/..` lexically before resolving the link. Resolve existing components, following links with a finite traversal bound, then append genuinely nonexistent normal components for new files/directories. Distinguish a missing ordinary leaf/ancestor from a broken symlink, cycle, unreadable component, or invalid input. The latter is undeterminable and follows the existing exit-2 contract. Do not silently return the original absolute path on resolution failure. Relative paths are interpreted from the hook's cwd; conclusively outside-project targets are not prohibited merely for being outside.

Apply the existing .docs/default-deny and marker `allow:` prefixes independently to both candidates; allow only if both permit the write. Unprotected candidates pass; a protected candidate needs a literal segment-safe exemption. Normalize target components before prefix matching, and do not resolve the marker's allow-prefix itself into a new exemption: an allowed directory symlink into .docs/plans must not authorize plans. This implements the user's explicit choice, not a new inferred permission model.

Keep paths as data: pass targets via stdin/argv/environment, never interpolate their bytes into executable JavaScript or shell source. Return a bounded decision token from the Node boundary and retain existing shell exit codes and rejection context. A second Node call is acceptable if it avoids changing the bounded parser contract; neither call may load mutable engine output. Regenerate the committed hook with `bin/generate-docs-guard-hook` after each source change and use its existing drift check.

Tests use the established runDocsGuardHook pattern in src/conductor/test/engine/session-hook-assets.test.ts: execute the real generated Bash text with a real temporary marker/payload and assert exit status and stderr. Extend the fixture narrowly to support cwd/PWD aliases, actual files and symlinks; use real temporary filesystem paths because path identity is the boundary under test. Never call a provider, GitHub, package installer or full Conductor.run(). The existing provider-neutral pre-commit and terminal seal remain authoritative for other hosts and write surfaces; this changes only the existing Claude early-feedback hook.

## Prerequisites

User approval recorded 2026-09-05: option A, both requested lexical path and resolved destination must satisfy current protection/allowlist rules. No outstanding issue dependency, package or host wiring change. Existing approved phase-scoped docs guard and provider-neutral commit-gate architecture remain in force.

## Tasks

### Task 1: Classify protected paths independently of root spelling

**Story:** Story 1
**Type:** negative-path
**Dependencies:** none
**Files:** src/conductor/src/engine/session-hook-assets.ts, hooks/claude/docs-guard.sh, src/conductor/test/engine/session-hook-assets.test.ts
**Files likely touched:** same as Files.

**Steps:**
1. Extend the existing real Bash hook fixture with a physical temporary root, logical cwd/PWD alias and alternate root alias. Supply absolute/relative targets, dot/traversal components, new leaves and missing ordinary parent directories; assert protected writes exit 2 in BUILD and SHIP. Establish RED through `ai-conductor scoped-run test/engine/session-hook-assets.test.ts` from src/conductor.
2. Replace literal PWD stripping with the Node-backed path classifier described above. Preserve requested and resolved candidates without applying shell evaluation to target bytes. Resolve symlink/traversal components in filesystem order, distinguish missing normal components from invalid/unresolvable links, and keep finite link-following work. Treat uncertain resolution as the already established undeterminable-target refusal.
3. Add concrete cycle/broken-link and injected unreadable-component coverage at the narrow resolution boundary, plus targets containing spaces/metacharacters. Preserve existing marker-absent/no-stdin behavior and ordinary non-.docs pass-through. A sibling .docs-archive and a conclusive outside-project target must pass; an alias pointing into protected .docs must not. Include an alternate project-root alias that is neither PWD nor the physical spelling, and retain its requested protected suffix before resolving an outward inner symlink.
4. Regenerate the committed hook from the TS source. Run the scoped tests, Bash syntax and generated-copy check for GREEN. Exercise representative alias protection and non-.docs pass-through against the committed hook as well as the source-derived hook so installation carries the same behavior. Commit the classifier and generated artifact together.

**Done when:**
- Generated and committed hook entry points reject protected targets through logical/physical/alternate aliases, dot/traversal spelling, and not-yet-created ordinary paths.
- Missing marker still exits without reading stdin; determined non-.docs and outside-project paths exit 0.
- Invalid/unresolvable paths, broken links and link cycles exit 2 without falling through as unprotected targets.
- Paths with whitespace/metacharacters stay literal data, and the generated-copy check passes.

### Task 2: Enforce the approved conjunction of requested and destination permissions

**Story:** Story 2
**Type:** negative-path
**Dependencies:** 1
**Files:** src/conductor/src/engine/session-hook-assets.ts, hooks/claude/docs-guard.sh, src/conductor/test/engine/session-hook-assets.test.ts
**Files likely touched:** same as Files.

**Steps:**
1. Add real temporary-filesystem hook cases with existing marker `allow: .docs/release-waivers/`: a permitted ordinary target, allowed-to-protected symlink, protected-to-outside/allowed symlink, and unprotected-to-protected symlink. Repeat the protected-to-outside case through an alternate root alias that is neither PWD nor the physical root spelling: `alternate-root/.docs/plans/outward-link` must exit 2. Assert 0 only when both interpretations permit the write, otherwise 2. Establish RED for any uncovered conjunction path through the scoped hook tests.
2. Apply the existing default-deny and literal allow-prefix policy to both candidate paths. Keep allow prefixes anchored to their declared .docs segments rather than canonicalizing an allowlisted symlink into authority for its destination. Normalize traversal components before exemption matching and retain protected requested paths even when their destination leaves .docs.
3. Cover `.docs/release-waivers/../plans/x.md`, similarly named sibling directories, and a symlink followed by `..` whose physical destination differs from lexical simplification. Assert permitted aliases stay permitted only when neither interpretation is protected without an exemption. Retain denial messages naming phase, step, marker and recovery guidance.
4. Regenerate the committed hook and run scoped hook tests, generated-copy check and the repository's test-covering typecheck for GREEN. Commit the dual-interpretation policy with its regressions. No new settings or hook registration is required.

**Done when:**
- Allowed-to-protected, protected-to-outside/allowed and unprotected-to-protected symlink writes all exit 2 at the real hook boundary.
- A protected requested suffix under an alternate root alias remains blocked when an inner symlink resolves outside .docs, even though the final destination itself is unprotected.
- A permitted target exits 0 through equivalent spellings only when both interpretations satisfy existing policy.
- Traversal and similarly named siblings cannot obtain an allow-prefix exemption, and symlink-plus-parent traversal follows filesystem meaning.
- Existing phase/step/marker refusal context remains present and the generated artifact matches its TS source.

## Coverage Dispositions

| Criteria | Lowest sufficient proof | Owner |
| --- | --- | --- |
| Root aliases, normal path components and new targets | Real generated/committed hook integration in temporary directories | Task 1 |
| Inactive marker; determined non-.docs/outside paths | Existing hook cases plus alias/sibling extensions | Task 1 |
| Invalid paths, links, cycles and read failure | Hook integration plus injected resolution failure at the narrow boundary | Task 1 |
| Both-interpreted permissions; three crossing directions | Real hook and symlink fixtures | Task 2 |
| Allow-prefix traversal, sibling boundaries and link/.. | Targeted real hook negative cases | Task 2 |
| Permitted alias and preserved denial context | Hook exit-status/stderr assertions | Task 2 |

Every criterion is diff-local. Task 1 owns path resolution at the host-tool-to-hook boundary; Task 2 owns the approved dual-permission decision there. Each owns scoped RED/GREEN tests and generation of its delivered hook bytes. No additional acceptance/system spec is needed because the actual hook process and filesystem are already exercised; no terminal catch-all task is appended.

## Verify-Claims

Verified directly: session-hook-assets.ts contains the literal-PWD strip and is the generated-hook source; its tests execute real Bash with temporary phase markers. The current unknown-target branch exits 2. The source-run generation wrapper avoids engine bundle writes. The user explicitly approved the dual-interpretation policy after its outward-symlink ambiguity was surfaced. No pending load-bearing assumptions; verdict CLEAR.
