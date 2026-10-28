# Conflict Check: Skill names resolve from frontmatter (Spec 1 of #885)

**Date:** 2026-10-14
**Stories checked:** `.docs/stories/namespace-harness-skill-and-agent-names-so-they-ca.md` (Stories 1-8) against all story files
**Result:** PASS after resolution — 0 blocking, 0 degrading remaining

## ADR corpus

Examined (APPROVED, subject overlaps skill naming, catalogs, install, self-host or dispatch):
`adr-2026-08-04-unresolved-step-command-fails-by-name`, `adr-2026-08-04-live-tier-provisions-its-own-provider-home`,
`adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation`, `adr-2026-09-28-skills-may-bundle-executable-helpers`,
`adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation`, `adr-2026-07-06-installed-root-resolution-for-global-writes`,
`adr-2026-06-30-sandbox-build-isolation`, `adr-2026-08-26-music-vocabulary-player-composer-rename`.

Narrowed out: ADRs on evidence, rebase, review rubrics, halts and GitHub writes, which set no skill-name,
catalog or install behavior. No ADR was excluded as superseded. An earlier scan of the full `ac-` rename
found conflicts only with artifacts pinning `ac-` literals; this spec changes no shipped name, so those
moved to the follow-up intake jstoup111/ai-conductor#3233.

## Conflict: Missing-name fallback vs custom steps

**Stories involved:** custom-steps-work-only-in-this-repo-engine-hardcod Story 4 vs Story 1, Story 2
**Type:** contradiction
**Severity:** degrading

**Description:** Custom steps fail closed when a skill declares no name and run skills from the project's own catalog; Stories 1-2 fell back to the directory name and ignored the project's file for every step.

**Resolution:** Stories 1-2 and ADR Decision 3 now scope to built-in steps; custom and `parallel[].skill` steps keep their existing resolution.

## Conflict: Which harness root non-self-host dispatch reads

**Stories involved:** live-daemon-e2e-build-step-never-runs-a-real-agent Story 1 vs Story 2
**Type:** overlap
**Severity:** degrading

**Description:** "Installed harness root" could mean the operator-global install, which the live tier must not depend on.

**Resolution:** Story 2 and ADR Decision 3 name the engine's module-relative harness root, with a directory-name fallback when it cannot be resolved.

## Conflict: Per-skill sandbox entries vs the whole-tree sandbox link

**Stories involved:** harness-self-host-guardrails TR-5 and ADR adr-2026-06-30-sandbox-build-isolation vs Story 6
**Type:** contradiction
**Severity:** degrading
**ADR filename stem:** adr-2026-06-30-sandbox-build-isolation
**Story ID:** Story 6
**ADR opposing sentence (verbatim):** "For a harness self-build only, run the build step with a **throwaway `CLAUDE_CONFIG_DIR`** whose `skills/` and `hooks/` symlink into the **build worktree's edited copies**."
**Story opposing sentence (verbatim):** "Given the Claude self-host sandbox over a worktree renamed fixture, when it is provisioned, then it exposes each worktree skill under its frontmatter name as a link resolving to that worktree's `skills/<dir>`."

**Resolution:** ADR Decision 3 now covers the sandbox, and the sandbox ADR carries a #885 amendment note. Each link still exposes the worktree's edited copy (TR-5 holds); the entry set is fixed at provisioning.

## Conflict: Live-tier preflight lookup key

**Stories involved:** adr-2026-08-04-unresolved-step-command-fails-by-name vs Story 6
**Type:** overlap
**Severity:** degrading

**Resolution:** Story 6 gained criteria that the preflight resolves step commands by frontmatter name; ADR Decision 3 names the preflight.

## Gaps resolved

- Install exit status on malformed frontmatter is specified as 1 (Story 8).
- Duplicate discovery under a renamed tree (old directory-named links) is reconciled by the follow-up intake #3233 (ADR Decision 4); Spec 1 ships no renamed tree.

## Clean pairs (both directions checked)

Pi pre-spawn lookup and install idempotence; Pi self-host isolation; Codex self-host parity NP-3/NP-5;
concurrent self-host isolation D3; bundled skill helpers; Codex skill adaptation D1/D2/D4; skill
frontmatter drift check; composer launcher and monitor triage (shipped names unchanged); install
uninstall and worktree guard; provider-home leak cleanup.
