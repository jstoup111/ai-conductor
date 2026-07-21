# Conflict Check: Remove Serena from harness dependencies and install (#753)

**Date:** 2026-07-21
**Stories checked:** `.docs/stories/remove-serena-harness-dependency.md` (6 stories)
against `.docs/stories/`, `.docs/specs/`, `.docs/decisions/`, and all open PRs.
**Result:** PASSED — zero blocking, zero degrading conflicts.

## Pair analysis

1. **vs closed spec PR #728 (`spec/multiple-serena-mcp-servers-spike-cpu-and-disk-acr`)
   — declared supersession, nothing to reconcile on main.** #728 specced the
   server-management approach (bounding/lifecycle-managing Serena servers) and was
   closed unmerged. Verified 2026-07-21: `grep -rl serena .docs/` on `origin/main`
   matches only the 2026-06-29 pluggable-memory artifacts (below) — no #728 spec,
   stories, plan, or ADR landed. This spec supersedes it cleanly at the issue level
   (#753 states the supersession); no artifact on main contradicts removal.

2. **vs `.docs/specs/2026-06-29-pluggable-memory-source.md` + the three 2026-06-29
   memory ADRs — historical mentions only.** These reference Serena as prior-art
   context for the memory-provider design, not as a dependency contract. They are
   shipped, append-only history; the removal changes no behavior they specified.
   No edit, no conflict.

3. **vs open PRs (#744, #679, #670, #629, #518, #151, #19, #18 — checked 2026-07-21)
   — no file overlap.** None touch `bin/install`, `skills/bootstrap/SKILL.md`,
   `HARNESS.md`'s MCP section, `registry-cli.ts`, or `registry-cli.test.ts`. #679
   edits CLAUDE.md docs (disjoint); #744/#670 are spec-only branches.

4. **vs the release-gate rules (CLAUDE.md Release & Update Gates §2, waiver ADR
   `adr-2026-07-06-migration-gate-waiver`) — compliant by construction.** The four
   canonical breaking surfaces are untouched, so neither a mandatory migration block
   nor a waiver is triggered; the voluntary `## Migration` block (ADR D1-C) rides the
   existing `bin/migrate` approval flow and conflicts with no gate semantics.

5. **vs bootstrap §5/§9 structure — internal renumbering only.** Deleting §9a leaves
   §9 (MCP Integration Setup, context7/GitHub/puppeteer) and §10+ intact; no other
   skill cross-references "§9a" (verified `grep -rn '9a' skills/`). The `.serena/`
   bullet removal in §5 leaves the other five gitignore bullets and the
   parity-with-conductor note coherent (the conductor skeleton loses `.serena/` in the
   same change — Story 4 keeps the two lists in parity).

## Recurring-pattern note

`.serena/` ignore-line semantics now differ by location (repo `.gitignore` keeps it,
skeleton drops it) — deliberately, per ADR D3. Future "clean sweep" passes should not
"fix" the repo `.gitignore` line without re-litigating the dirty-worktree rationale.
