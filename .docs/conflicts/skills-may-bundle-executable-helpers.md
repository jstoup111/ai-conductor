# Conflict Check: Skills may bundle executable helpers (#742)

**Date:** 2026-09-28
**ADR corpus:** `repo_wide` (per `.ai-conductor/config.yml`)
**Stories checked:** `.docs/stories/skills-may-bundle-executable-helpers.md` (Stories 1–4) against all
stories in `.docs/stories/` and all ADRs in `.docs/decisions/`.
**Result:** PASSED. Zero blocking conflicts. Seven degrading conflicts: six resolved in this DECIDE
pass, and one (C6) accepted as compatible with no change.

## Conflict C1: Moving a shipped shell script drops it from interpreter-source coverage

**Stories involved:** handle-runtime-values-as-literal-data Story 4 vs Story 3 (this spec)
**Files:** [.docs/stories/handle-runtime-values-as-literal-data-across-inter.md] vs [.docs/stories/skills-may-bundle-executable-helpers.md]
**Type:** resource-contention
**Severity:** degrading

**Description:** The existing story requires every new shipped shell script to be included in
interpreter-source validation automatically. The inventory in
`src/conductor/scripts/check-interpreter-source.mts` enumerates only `bin/` and `hooks/`, so moving
`intake-file` into `skills/intake/scripts/` would silently drop it from that check.

**Resolution Options:**
1. Add `skills/*/scripts/` to the interpreter-source inventory.
2. Derive the inventory from `lint_shell.sh --list`.
3. Keep helpers out of that check and waive the story.

**Recommendation / applied:** Option 1. ADR D6 now names the inventory, and Story 3 gains an inventory
criterion, a negative path, and a Done-when item.

## Conflict C2: A git-detected rename into `skills/` fires the release gate's skill-surface rule

**Stories involved:** ADR adr-2026-08-01-scoped-run-verb-release-surface vs ADR D7 (this spec)
**Files:** [.docs/decisions/adr-2026-08-01-scoped-run-verb-release-surface.md] vs [.docs/decisions/adr-2026-09-28-skills-may-bundle-executable-helpers.md]
**Type:** sequencing
**Severity:** degrading
**ADR filename stem:** adr-2026-08-01-scoped-run-verb-release-surface
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "| `p.startsWith('skills/')` **and** removed or renamed | `skill symlink targets` |"
**Story opposing sentence (verbatim):** "Given the helper is run by its path inside that installed skill directory"

**Description:** The release gate reads `git diff --name-status`, which detects renames. If git pairs
`bin/intake-file` with the new helper, the diff shows a rename into `skills/`, so the gate demands a
migration block or waiver that the design says is unnecessary.

**Resolution Options:**
1. Author the helper as a new file so rename detection does not pair it.
2. Plan a release waiver for `skill symlink targets`.
3. Keep `bin/intake-file` as a shim.

**Recommendation / applied:** Option 1. ADR Consequences and the architecture review record it, and
the plan's migration task carries it as a Done-when check.

## Conflict C3: An accepted intake story still asserts the skill files through `bin/intake-file`

**Stories involved:** intake-only-enforcement Story 2 vs Story 1 (this spec)
**Files:** [.docs/stories/intake-only-enforcement.md] vs [.docs/stories/skills-may-bundle-executable-helpers.md]
**Type:** state-conflict
**Severity:** degrading

**Description:** intake-only-enforcement Story 2 says "Given the `/intake` skill's §7 GATE / §8 File,
then they direct the filer through `bin/intake-file`", and its Done-when requires that reference. This
spec removes `bin/intake-file` and has the skill name its helper by skill-directory path.

**Resolution Options:**
1. Replace the superseded assertions in intake-only-enforcement Story 2 in place.
2. Keep a `bin/intake-file` shim so the old assertion stays true.

**Recommendation / applied:** Option 1. The land stem gate rejects edits to another feature's
stories from this branch, so the replacement ships as a companion main-based PR that merges with this
spec.

## Conflict C4: A fixed-depth self-location misses the worktree engine in self-host runs

**Stories involved:** ADR adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation vs ADR D4 (this spec)
**Files:** [.docs/decisions/adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation.md] vs [.docs/decisions/adr-2026-09-28-skills-may-bundle-executable-helpers.md]
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "Claude receives a throwaway `CLAUDE_CONFIG_DIR` containing only […] worktree-owned harness skills/hooks"
**Story opposing sentence (verbatim):** "Given the helper's physical location has no engine entry point above it (as in a self-host provider-home copy) and an `ai-conductor` on `PATH` whose physical location is inside a harness checkout with the engine entry point, when it resolves the harness root, then it uses that checkout."

**Description:** The original D4 resolved the root at a fixed depth and fell back straight to the
operator's installed engine. But the provider home is under the worktree
(adr-2026-08-09-worktree-local-provider-scratch), so the worktree's own engine is an ancestor of the
copy. Skipping it departs from the worktree-owned-assets principle, and the ADR's claim that the copy
is "outside any checkout" was wrong.

**Resolution Options:**
1. Walk ancestors for the nearest directory holding the engine entry point and its installed runner,
   then fall back to `PATH`.
2. Have the provider home export the worktree root in an environment variable.
3. Accept the `PATH` fallback in self-host.

**Recommendation / applied:** Option 1. It needs no new environment surface, prefers the worktree's
engine, and requiring the installed runner also closes the "entry point present but `tsx` missing"
gap. ADR Context, D4, and Consequences, Story 2, the review, and the diagram are updated. The story
sentence quoted above is the superseded one.

## Conflict C5: The live-tier ADR's copy trade-off assumes `skills/` is Markdown-only

**Stories involved:** ADR adr-2026-08-04-live-tier-provisions-its-own-provider-home vs ADR D1 (this spec)
**Files:** [.docs/decisions/adr-2026-08-04-live-tier-provisions-its-own-provider-home.md] vs [.docs/decisions/adr-2026-09-28-skills-may-bundle-executable-helpers.md]
**Type:** state-conflict
**Severity:** degrading
**ADR filename stem:** adr-2026-08-04-live-tier-provisions-its-own-provider-home
**Story ID:** Story 4
**ADR opposing sentence (verbatim):** "Copying `skills/` per run costs a directory copy instead of a symlink. The asset is small and markdown-only"
**Story opposing sentence (verbatim):** "Given a self-host provider home is materialized from a worktree containing the bundled helper, when the copied skills are inspected, then `intake/scripts/intake-file` is present with its executable mode preserved."

**Description:** The copy is still correct and still small; only the "markdown-only" adjective in that
ADR's Consequences cost note becomes stale.

**Resolution Options:**
1. Name the overtaken premise in the new ADR's Context and correct the matching code comment.
2. Add an amendment note to the live-tier ADR.

**Recommendation / applied:** Option 1. The live-tier ADR's `## Decision` has no numbered items, so an
amendment would make the land gate reject it as an approved ADR with no citable decision. The stale
premise sits in a cost note, not a decision.

## Conflict C6: Repository resolution from the working directory

**Stories involved:** ADR adr-2026-09-11-github-operation-ownership D2 vs Story 1 (this spec)
**Files:** [.docs/decisions/adr-2026-09-11-github-operation-ownership.md] vs [.docs/stories/skills-may-bundle-executable-helpers.md]
**Type:** overlap
**Severity:** degrading (accepted as compatible)
**ADR filename stem:** adr-2026-09-11-github-operation-ownership
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "Resolve the canonical repository and exact branch/PR identity, not a cwd guess or body marker alone."
**Story opposing sentence (verbatim):** "Given the helper is run from a foreign working directory without an explicit repository argument, when the entry point resolves the filing repository, then it resolves the repository of the caller's working directory rather than the harness repository."

**Description:** D2 governs feature resources such as branches and PRs. Intake creation is scoped to
the destination repository, and the entry point already resolves that repository from its working
directory through the GitHub CLI's canonical lookup, not by guessing. This spec changes only which
working directory the entry point sees.

**Recommendation / applied:** No change.

## Conflict C7: Host-scoped invocation wording

**Stories involved:** first-class-codex-harness-parity-904 ST-904-7 vs Story 1 (this spec)
**Files:** [.docs/stories/first-class-codex-harness-parity-904.md] vs [.docs/stories/skills-may-bundle-executable-helpers.md]
**Type:** overlap
**Severity:** degrading

**Description:** ST-904-7 requires host-dependent instructions to identify the host they apply to and
give a valid path for it. The skill-directory instruction differs by host.

**Resolution Options:**
1. Have the `SKILL.md` instruction name how each supported host supplies the skill directory.

**Recommendation / applied:** Option 1. Story 1's Done-when now requires both host branches.

## Internal consistency fixes

- ADR D1 and Story 3 now agree on the qualifying shebang: `bash` or `sh`.
- The ambiguous "two levels above `scripts/`" in D4 is replaced by the ancestor walk.

## Examined and judged compatible (summary)

001-harness-architecture (amended here), 002-plugin-manifest-and-discovery,
adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation, cover-nested-bin-shell-files-in-both-lint-gates,
adr-2026-09-11-github-operation-ownership D7 (the audit already scans extensionless skill files),
use-a-dedicated-bot-identity D9, adr-2026-06-30-halt-based-release-gates, adr-2026-07-06-migration-gate-waiver,
adr-2026-07-03-version-gate-semver-escalation, adr-2026-07-06-installed-root-resolution-for-global-writes,
adr-2026-08-17-structural-live-checkout-containment (the helper now writes caller `.pipeline/`, which is volatile),
adr-2026-08-09-worktree-local-provider-scratch, adr-2026-07-21-intake-only-enforcement,
adr-2026-07-23-intake-label-authority-scoped-replace, adr-2026-09-06-inbound-intake-trust-boundary,
adr-012 and adr-2026-08-12-fail-closed-intake-ledger-durability, adr-2026-08-13-markdown-default-inversion,
adr-2026-08-04-unresolved-step-command-fails-by-name, adr-2026-09-23-engine-git-guard-on-agent-path,
adr-2026-09-10-portable-build-review-policy, adr-2026-06-29-per-provider-retrieval-guidance-location.

## Narrowed out

Build-review, rubric, kickback, coherence, rebase, and verdict-artifact ADRs and stories (their
"markdown-only" hits concern verdict artifacts). Telemetry, cost, daemon scheduling, lease, park, and
halt ADRs. Changelog and release-PR ADRs apart from the breaking-surface classifier. Codex readiness,
auth, and model-routing stories. Intake claim-semantics stories. `install --check` stories, which
compare symlink targets, not per-file contents.
