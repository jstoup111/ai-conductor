# Implementation Plan: finish/pr staleness-proof grep never matches git's actual "rebase (finish)" reflog wording

Stem: finish-staleness-grep-never-matches-rebase-finish
Track: technical
Tier: S
Source: jstoup111/ai-conductor#587

## Goal

Stop the finish (and pr) skill's staleness-proof fallback from silently never matching. Both
`skills/finish/SKILL.md:87` and `skills/pr/SKILL.md:167` run `git reflog | grep "rebase: finish"`,
but git actually writes `rebase (finish): returning to refs/heads/<branch>` — confirmed empirically
in this investigation with a real `git rebase` reproduction. Correct the grep pattern in both
files to match git's real wording, update the surrounding prose/checklists that quote the wrong
literal, and add regression coverage that pins the corrected pattern against a real reflog capture
so this exact bug class cannot silently regress again.

## Scope Decision — correct the grep in place (a), not engine machinery (b)

**Decision: (a) — correct the literal string in both SKILL.md files.** Considered and rejected
moving the staleness-proof derivation into engine machinery (a new `conduct-ts` primitive the
skills would call, mirroring how `finish-record-cli.ts`/`push-evidence.ts` made finish-choice
*recording* engine-owned per #499/PR #575).

Rationale:
- **This is not the class of bug the "deterministic where possible" principle targets.** That
  principle exists for cases where an LLM agent's judgement or prompt discipline is unreliable and
  needs to be replaced by machinery. Here the check was **already** meant to be a mechanical,
  deterministic grep against a fixed git literal — the defect is a plain miscopy of that literal
  (`"rebase: finish"` vs. the real `rebase (finish):`), not agent drift. Fixing the string restores
  full determinism at the existing call site; no agent judgement is involved in either the broken
  or the fixed version.
- **#499/PR #575's engine machinery is a different concern.** `finish-record-cli.ts` and
  `push-evidence.ts` verify that a push/PR already landed, *after* the push attempt — they do not
  decide whether the pre-push force-with-lease staleness proof is authorized. Moving the
  proof itself into the engine would mean designing a new CLI primitive, an interface for its
  verdict, and wiring two skill call sites — a materially larger change than the S-tier grep fix
  this issue asks for, and out of proportion to a copy-paste literal defect.
- **The issue's own "Expected auto-remediation"** explicitly asks for the grep-pattern fix (`grep -E
  "rebase \(finish\)"`), and the task framing designates this a TECHNICAL/small-bug track.
- A future engine-owned staleness-proof primitive remains a legitimate larger idea (it would also
  let it address the twice-rebased `ORIG_HEAD`-ancestry limitation the issue notes as a contributing
  factor) — flagged as a non-goal below for a separate issue, not invented here.

No architecture, no ADR, no new decision surface — this is a prose/prompt correction confirmed by a
real git reproduction, not a design change.

## Files

- `skills/finish/SKILL.md` — Task 1. Correct the fallback grep (line 87) from
  `git reflog | grep "rebase: finish"` to `git reflog | grep -E "rebase \(finish\)"`, and update the
  surrounding prose (lines 89, 117) and verification checklist (line 382) that quote or describe the
  old literal.
- `skills/pr/SKILL.md` — Task 2. Same correction: fallback grep (line 167), surrounding prose (lines
  169, 189), and verification checklist (line 240).
- `src/conductor/test/finish-staleness-grep.test.ts` — Task 3 (new file). Regression test
  that captures a real `git rebase` reflog and asserts the corrected pattern matches it and the old
  literal does not, so this exact bug class is pinned mechanically even though the check itself
  lives in prose.
- `CHANGELOG.md` — Task 4. Required `## [Unreleased]` → `### Fixed` entry (harness repo gate).

## Non-goals

- **No change to the merge-base fast-path proof** (`git merge-base --is-ancestor origin/<branch>
  ORIG_HEAD`) or its known limitation on twice-rebased branches (`ORIG_HEAD` only reflects the most
  recent rebase). The issue names this as a contributing factor, not the defect to fix here —
  addressing it would require walking reflog history across multiple rebases, a materially larger
  design change. Flagged as a latent follow-up, not fixed in this S-tier grep correction.
- **No engine-machinery primitive for the staleness proof** (the (a)-vs-(b) decision above) — the
  proof stays prompt-level in both skills, corrected in place.
- **No change to `finish-record-cli.ts`, `push-evidence.ts`, or any other engine code.** Those
  verify push/PR landing after the fact and are unaffected by which literal the pre-push grep
  matches.
- **No CHANGELOG Migration block.** This edits SKILL.md prose only (no `bin/conduct` CLI, no
  `settings.json` schema, no hook wiring, no skill symlink target change) — a non-breaking PATCH
  bugfix. A plain `### Fixed` entry is correct.
- No VERSION bump beyond the frozen operator policy.

## Task Dependency Graph

```
Task 1 (fix finish/SKILL.md grep + prose)   ─┐
Task 2 (fix pr/SKILL.md grep + prose)       ─┤ independent, can run in either order
                                              │
Task 3 (regression test pinning both patterns) [depends on Tasks 1-2 for the corrected literal]
Task 4 (CHANGELOG + validate)                 [depends on Tasks 1-3]
```

## Tasks

### Task 1: Correct the fallback reflog grep and prose in skills/finish/SKILL.md

In `skills/finish/SKILL.md`:

- Line 87: change
  ```
  git reflog | grep "rebase: finish"
  ```
  to
  ```
  git reflog | grep -E "rebase \(finish\)"
  ```
- Line 89: change `If you see a "rebase: finish" entry, the daemon rebased this branch as part of`
  to `If you see a "rebase (finish):" entry, the daemon rebased this branch as part of` (match git's
  actual wording — parenthesized, no colon after "rebase").
- Line 117: change `exits non-zero AND no reflog "rebase: finish" entry exists` to `exits non-zero
  AND no reflog "rebase (finish):" entry exists`.
- Line 382 (verification checklist): change `reflog former-head` wording, if it references the old
  literal, to reference `rebase (finish):` explicitly instead of the generic phrase, so the
  checklist itself does not silently re-encode the wrong string in a future edit. (Current text
  reads "ORIG_HEAD ancestry / reflog former-head" — add the literal `rebase (finish):` so the
  checklist is self-verifying.)

Add a short inline note next to the corrected grep explaining git's actual wording and citing #587,
mirroring the auto-park precedent's clarifying-comment convention, so a future editor does not
"simplify" it back to the wrong literal.

Dependencies: none. Files: `skills/finish/SKILL.md`.
Estimated: 5 min.

### Task 2: Correct the fallback reflog grep and prose in skills/pr/SKILL.md

In `skills/pr/SKILL.md`, apply the identical correction PR #265 originally applied to both files in
parallel:

- Line 167: change `git reflog | grep "rebase: finish"` to
  `git reflog | grep -E "rebase \(finish\)"`.
- Line 169: change `If you see a "rebase: finish" entry, the branch was rebased as part of
  completion.` to `If you see a "rebase (finish):" entry, the branch was rebased as part of
  completion.`
- Line 189 (Failure handling): change `If merge-base exits non-zero and no "rebase: finish" reflog`
  to `If merge-base exits non-zero and no "rebase (finish):" reflog`.
- Line 240 (verification checklist): the existing line ("staleness proof (merge-base or reflog) ran
  and passed") does not quote the wrong literal directly — leave as-is unless the corrected pattern
  needs an explicit citation for symmetry with Task 1; if so, add the same `rebase (finish):`
  literal reference.

Dependencies: none (parallel to Task 1). Files: `skills/pr/SKILL.md`.
Estimated: 5 min.

### Task 3: Regression test — pin the corrected pattern against a real reflog capture

Create `src/conductor/test/finish-staleness-grep.test.ts` (flat top-level test file, matching
the existing convention of prose/config-adjacent tests like `test/generate-model-table.test.ts`
and `test/model-table-metadata.test.ts` — there is no dedicated `test/skills/` directory in this
repo, so this stays flat rather than inventing a new directory convention).

Test approach (no code under test — this test exercises real `git` in a scratch repo, plus the
literal patterns extracted from the two SKILL.md files, to keep the regression coupled to the
actual files rather than a hardcoded copy):

- **Setup:** in a temp directory, `git init`, create two branches with diverging commits, and run a
  real `git rebase` so git itself writes the `rebase (finish): returning to refs/heads/<branch>`
  reflog entry (mirrors the manual reproduction already performed during this investigation).
- **Assertion 1 (happy — Story 1):** read the corrected pattern directly out of
  `skills/finish/SKILL.md` (extract the `grep -E "..."` argument via a small regex on the file
  text) and confirm it matches at least one line of `git reflog`'s real output in the scratch repo.
  Repeat for `skills/pr/SKILL.md`'s corrected pattern.
- **Assertion 2 (regression guard):** confirm the OLD literal (`"rebase: finish"`, a plain
  substring match) does NOT appear anywhere in `git reflog`'s real output — documenting exactly why
  the old pattern silently never matched.
- **Assertion 3 (negative — Story 2, no over-match):** construct a reflog-like line containing the
  bare word "finish" in an unrelated context (e.g. a commit subject `commit: finish the retry
  logic`) and confirm the corrected `-E "rebase \(finish\)"` pattern does NOT match it — the
  parenthesized anchor prevents a bare-substring false positive.
- Extract-from-file approach means if a future edit reintroduces the wrong literal in either
  SKILL.md, this test fails against real git output rather than asserting a copy of the intended
  fix.

Dependencies: Tasks 1-2 (test reads the corrected files). Files:
`src/conductor/test/finish-staleness-grep.test.ts`.
Estimated: 10 min.

### Task 4: CHANGELOG entry and validate

Add under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`:
"Finish and pr skills' staleness-proof fallback now matches git's actual reflog wording:
`git reflog | grep "rebase: finish"` never matched real git output (git writes `rebase (finish):
returning to refs/heads/<branch>`, parenthesized, no colon), so on any branch where the merge-base
ancestry fast path also failed (e.g. a twice-rebased branch), finish/pr wrongly concluded foreign
commits existed on the remote and halted for human review. Corrected to `grep -E "rebase
\(finish\)"` in both `skills/finish/SKILL.md` and `skills/pr/SKILL.md` (ai-conductor#587)."

Then run:
- from `src/conductor`: `npx vitest run test/finish-staleness-grep.test.ts` (correct cwd per
  the vitest-cwd trap);
- `test/test_harness_integrity.sh` from the repo root — SKILL.md edits must still pass frontmatter/
  section-numbering validation.

Fix any failure before completing.

Dependencies: Tasks 1-3. Files: `CHANGELOG.md`.
Estimated: 5 min.

## Verification

- The corrected grep pattern in both `skills/finish/SKILL.md` and `skills/pr/SKILL.md` matches a
  real `git rebase`-produced reflog entry (`rebase (finish): returning to refs/heads/<branch>`);
  the old literal (`"rebase: finish"`) is confirmed to never match real git output.
- The corrected pattern does not over-match an unrelated reflog line containing the bare word
  "finish" outside the `rebase (finish):` context.
- `cd src/conductor && npx vitest run test/finish-staleness-grep.test.ts` green;
  `test/test_harness_integrity.sh` passes; `CHANGELOG.md` has the `## [Unreleased]` Fixed entry.
- Manual re-read of both SKILL.md files confirms no remaining reference to the wrong literal in
  prose, code fences, or the verification checklists.

## Coverage Mapping

| Story / Scenario | Task(s) | Test / Evidence |
|---|---|---|
| Story 1 — real in-progress-rebase reflog entry recognized as staleness proof | 1, 2, 3 | `finish-staleness-grep.test.ts` Assertion 1 (corrected pattern matches real reflog output) |
| Story 2 — genuinely foreign commit still caught (no rebase reflog entry) | 1, 2 | Prose/gate logic unchanged — only the fallback literal is corrected; the STOP-on-unproven-staleness gate (§1b "Failed Staleness Proof") is untouched |
| Story 2 — corrected pattern does not over-match unrelated "finish" text | 3 | `finish-staleness-grep.test.ts` Assertion 3 |
| Regression guard (old literal never matched — documents the bug) | 3 | `finish-staleness-grep.test.ts` Assertion 2 |
| Release gate | 4 | `CHANGELOG.md` `## [Unreleased]` Fixed entry; integrity suite green |
