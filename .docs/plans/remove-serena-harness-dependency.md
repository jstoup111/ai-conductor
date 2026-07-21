# Implementation Plan: Remove Serena from harness dependencies and install

**Date:** 2026-07-21
**Issue:** #753 — "Remove Serena from harness dependencies and install — out of scope for the daemon" (priority: critical, v1.0 gate; supersedes #682 and closed spec PR #728)
**Stem:** `remove-serena-harness-dependency`
**Stories:** `.docs/stories/remove-serena-harness-dependency.md`
**Complexity:** `.docs/complexity/remove-serena-harness-dependency.md` (Tier: S)
**ADR:** `.docs/decisions/adr-2026-07-21-serena-removal-path.md` (APPROVED)
**Conflict check:** `.docs/conflicts/remove-serena-harness-dependency.md`
**Track:** technical (no PRD)

## Goal

Remove Serena from the harness entirely — install path, bootstrap MCP registration, agent
guidance, and generated config — and give existing deployments an approval-gated clean
removal path (ADR D1-C). After this change: fresh installs never mention Serena;
`/bootstrap` registers nothing even when `serena` is on PATH; HARNESS.md carries no
Serena instruction; scaffolded projects don't seed `.serena/`; the migration unregisters
the user-scope MCP server (guarded, idempotent) and prints — never runs — optional
cleanup commands. The harness repo's own `.gitignore` keeps its `.serena/` line (ADR D3).

## Non-goals

- No server bounding/lifecycle management (rejected #728 approach).
- Never uninstall `serena-agent` or `uv`; never touch the operator's own out-of-harness
  MCP registrations except via the approved migration block (ADR D2).
- Don't touch context7 guidance, the puppeteer MCP install, rtk, or the mermaid-renderer
  flow in `bin/install`.
- Don't rewrite historical CHANGELOG entries or historical `.docs/` artifacts that
  mention Serena; don't edit already-seeded consumer `.gitignore`s.
- No release-gate waiver — the four canonical breaking surfaces are untouched.

## Task Dependency Graph

```
Task 1 (GITIGNORE_SKELETON + test flip, RED first)      [independent]
Task 2 (bin/install: Serena + uv-for-Serena blocks)     [independent]
Task 3 (bootstrap SKILL.md: §9a + §5 bullet)            [independent]
Task 4 (HARNESS.md MCP section)                         [independent]
Task 5 (README.md)                                      [independent]
Tasks 1-5
   └─> Task 6 (CHANGELOG Removed entry + Migration block)
          └─> Task 7 (verification sweep: grep + integrity + suites)
```

## Tasks

### Task 1: Drop `.serena/` from `GITIGNORE_SKELETON` (RED first)
**Story:** Story 4
**Type:** negative-path
**Steps:**
1. RED: flip the integration assertions in
   `src/conductor/test/integration/registry-cli.test.ts:299,305` — the seeded
   `.gitignore` must contain `.pipeline/`, `.daemon/`, `.worktrees/` and must NOT
   contain `.serena/` (`expect(gitignore).not.toContain('.serena/')`); update the
   `:299` comment. Test fails against current skeleton.
2. GREEN: remove `'.serena/'` from `GITIGNORE_SKELETON` in
   `src/conductor/src/engine/registry-cli.ts:106`.
3. Leave the harness repo's own `.gitignore:31` (`.serena/`) in place — ADR D3; add no
   code comment churn elsewhere.
4. Commit: "feat(registry): stop seeding .serena/ into scaffolded gitignores (#753)"
**Files likely touched:** `src/conductor/src/engine/registry-cli.ts`, `src/conductor/test/integration/registry-cli.test.ts`
**Dependencies:** none

### Task 2: Remove the Serena + uv-for-Serena blocks from `bin/install`
**Story:** Story 1
**Type:** negative-path
**Steps:**
1. Delete the entire Serena section of the tool-install function in `bin/install`
   (`:499-565` in current numbering): the leading comment block, the uv-offer ladder
   (uv exists here solely as Serena's installer — brew/curl/wget rungs, PATH pickup),
   and the `serena` detect/prompt/install/skip branches. The puppeteer MCP block
   immediately above and the markdown-viewer section below stay byte-identical.
2. Verify `grep -in 'serena\|astral.sh/uv\|uv tool install' bin/install` returns
   nothing and `bash -n bin/install` parses.
3. Smoke: run `./bin/install --help` (or the repo's install smoke path) to confirm no
   prompt regression; `test/test_install_worktree_guard.sh` still passes.
4. Commit: "feat(install): remove Serena and uv-for-Serena install offers (#753)"
**Files likely touched:** `bin/install`
**Dependencies:** none

### Task 3: Remove bootstrap §9a and the `.serena/` gitignore-seed bullet
**Story:** Story 2
**Type:** negative-path
**Steps:**
1. In `skills/bootstrap/SKILL.md`, delete section "9a. Serena Semantic Code Toolkit
   (if installed)" (`:343-363`) whole — detect, already-set-up check,
   `claude mcp add --scope user serena …` registration, `serena init` verify. §9 and
   §10 headings and numbering are untouched (9a is an inserted subsection; nothing
   cross-references it — verified `grep -rn '9a' skills/`).
2. Delete the `.serena/` bullet from the §5 "Add to `.gitignore`" list (`:293`),
   keeping the other five bullets and keeping the list in parity with Task 1's
   skeleton (the parity note in §5 stays true).
3. Verify `grep -in serena skills/` returns nothing.
4. Commit: "feat(bootstrap): drop Serena MCP registration and .serena/ seed (#753)"
**Files likely touched:** `skills/bootstrap/SKILL.md`
**Dependencies:** none

### Task 4: Remove Serena guidance from HARNESS.md
**Story:** Story 3
**Type:** negative-path
**Steps:**
1. In `HARNESS.md` "MCP Servers (When Available)" (`:261-267`): reword the intro line
   to context7-only ("When the context7 MCP server is installed, use it
   proactively:"), keep the context7 bullet, delete the serena bullet and the
   "Both installed" workflow bullet.
2. Verify `grep -in serena HARNESS.md` returns nothing and
   `test/test_harness_integrity.sh` passes (model table is generated from skill
   frontmatter — unaffected — but run the full script to catch reference drift).
3. Commit: "feat(harness): remove Serena usage instruction from MCP guidance (#753)"
**Files likely touched:** `HARNESS.md`
**Dependencies:** none

### Task 5: Remove Serena from README
**Story:** Story 1, Story 4
**Type:** negative-path
**Steps:**
1. `README.md:14` — delete the "Optional: `uv` … Serena" requirements bullet.
2. `README.md:33-37` — delete the "**Optional: Serena semantic code toolkit.**"
   install paragraph.
3. `README.md:1943` — in the `conduct create` skeleton description, drop `.serena/`
   from the ignored-directories list (matches Task 1's skeleton).
4. Verify `grep -in serena README.md` returns nothing.
5. Commit: "docs(readme): remove Serena optional-integration docs (#753)"
**Files likely touched:** `README.md`
**Dependencies:** none

### Task 6: CHANGELOG entry + approval-gated migration block (ADR D1-C/D2)
**Story:** Story 5
**Type:** happy-path + negative-path
**Steps:**
1. Add under `## [Unreleased]` → `### Removed` in `CHANGELOG.md`: Serena removed from
   install, bootstrap registration, HARNESS.md guidance, and the gitignore skeleton;
   rationale one-liner (out of scope for the daemon; #753 superseding #682/#728);
   note that the harness never uninstalls `serena-agent`/`uv` (ADR D2) and that the
   repo-local `.serena/` ignore line is retained deliberately (ADR D3).
2. Add a `## Migration` section for the same entry with a ```` ```bash migration ````
   fenced block, guarded and idempotent per ADR D1-C:
   ```bash
   # Unregister the harness-registered user-scope Serena MCP server (no-op if absent)
   if command -v claude >/dev/null 2>&1 && claude mcp get serena >/dev/null 2>&1; then
     claude mcp remove --scope user serena
     echo "Removed user-scope 'serena' MCP registration."
   else
     echo "No user-scope 'serena' MCP registration found — nothing to do."
   fi
   echo "Optional manual cleanup (NOT run automatically):"
   echo "  uv tool uninstall serena-agent   # if you don't use Serena elsewhere"
   echo "  pkill -f 'serena start-mcp-server'   # stop stray servers from old sessions"
   echo "  rm -rf <project>/.serena/            # per-project semantic-index caches"
   ```
   The block must exit 0 on both branches (Story 5's never-registered case) and be
   safe to re-run.
3. Confirm `bin/migrate`'s extractor picks the block up (its parser reads
   ```` ```bash migration ```` fences under `## Migration` — `bin/migrate:163-170`).
4. Commit: "docs(changelog): Serena removal entry + approval-gated unregister migration (#753)"
**Files likely touched:** `CHANGELOG.md`
**Dependencies:** Task 1, Task 2, Task 3, Task 4, Task 5

### Task 7: Repo-wide verification sweep
**Story:** Story 1, Story 2, Story 3, Story 4, Story 6
**Type:** verification
**Verify-only:** yes
**Steps:**
1. `grep -rin serena` across the repo returns hits ONLY in: `CHANGELOG.md` (historical
   entries + the new Removed/Migration entry), `.docs/` (historical artifacts + this
   spec set), and the harness repo's own `.gitignore` (ADR D3 keep). Zero hits in
   `bin/`, `hooks/`, `skills/`, `agents/`, `templates/`, `HARNESS.md`, `README.md`,
   `src/`, `test/`.
2. `test/test_harness_integrity.sh` — green (intake Owner markers, model table, skill
   references).
3. Conductor suite (`npm test` in `src/conductor/`) — green, including the flipped
   `registry-cli.test.ts` assertions.
4. Story 6's runtime outcome (zero `serena start-mcp-server` processes during daemon
   builds) is an operational observation on an updated host post-migration — record it
   in the manual-test notes; it is not CI-assertable here.
**Files likely touched:** none (verification only)
**Dependencies:** Task 6
