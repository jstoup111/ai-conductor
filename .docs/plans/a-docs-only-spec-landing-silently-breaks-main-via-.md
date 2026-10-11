# Implementation Plan: Docs-only spec landings cannot silently break main through the live `.docs/` corpus

**Date:** 2026-10-10
**Design:** none (technical track, Tier S — see `.docs/track/a-docs-only-spec-landing-silently-breaks-main-via-.md`)
**Stories:** .docs/stories/a-docs-only-spec-landing-silently-breaks-main-via-.md
**Conflict check:** Not required (Tier S)

## Summary

Gather every default-suite test whose verdict depends on the live repository `.docs/` corpus into
one live-corpus test tier, make the projection-limit checks in it assert admission instead of
equality with recorded maxima, re-record the PRD-audit maxima from the corpus at BUILD, and run the
tier on docs-only pull requests through a `ci-gate`-wired CI job. Six tasks.

## Technical Approach

- **The failure.** `.github/workflows/ci.yml` skips every test job when all changed paths are under
  `.docs/` (`.github/scripts/ci-detect-docs-only.sh`), and CI does not run on main after merge.
  Several default-suite tests read the live `.docs/` corpus, so a docs-only spec PR can merge green
  and leave main red. The PRD-audit limit test (`src/conductor/test/engine/prd-audit-projection.test.ts`,
  "ships finite corpus-based limits…") makes this near-certain because it asserts
  `PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES` *equals* the live largest file sizes. It broke main
  on 2026-10-10 after #2879, and again after #3138 added
  `.docs/coherence/a-change-to-one-stacked-child-cannot-be-carried-in.md` at 68,397 bytes. That
  file also exceeds the current derived coherence limit, `roundUpPowerOfTwo(54_846)` = 65,536. The
  remediation limit test (`src/conductor/test/engine/remediation-projection.test.ts`, "ships finite
  corpus-sized structured limits…") has the same equality shape for `tasksBytes`.
- **Admission, not equality.** The governing decision is decision 1 of the 2026-09-30 PRD-audit
  architecture review (`architecture-review-2026-09-30-prd-audit-receives-bounded-inputs-and-returns-vali`).
  It says to choose PRD-intent, coherence, and history constants "from the corresponding repository
  corpus at BUILD, rounded upward and recorded alongside the constants; each must fit the largest
  corresponding normal input observed then". Recorded maxima are therefore a BUILD-time snapshot.
  The perpetual invariant is that the shipped limit admits the live corpus. The as-built limit test
  (`src/conductor/test/as-built-projection.test.ts`, "keeps the largest plan, stories, and
  governing-ADR decision corpus inputs within shipped byte limits") already uses that admission
  shape (`toBeGreaterThanOrEqual`). It is the local pattern to follow. Derivation assertions, which
  check that each limit is the documented `roundUpPowerOfTwo` of maxima, floors, and overhead, stay
  as they are.
- **Re-record PRD-audit maxima at BUILD.** Measure the live corpus with the same measurement the
  test uses. Update every changed `PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES` entry, with the source
  artifact and its size in a comment beside the constant. This follows decision 1 and the comment
  style of `REMEDIATION_PROJECTION_COMPONENT_LIMITS`. With coherence at 68,397, the coherence limit
  becomes 131,072. The total stays 2 MiB:
  3×262,144 + 32,768 + 131,072 + 262,144 + 524,288 + 65,536 = 1,802,240, which rounds up to
  2,097,152. Floors and the derivation formula do not change, and no ADR changes.
- **Live-corpus tier.** Create `src/conductor/test/corpus/`. Every test file in it reads the
  repository's live `.docs/` corpus, and no other file does. The default Vitest `include`
  (`test/**/*.test.ts`) already covers it, so the full suite and the `conductor` shards still run
  each check once. Tests moved into it:
  - the PRD-audit, remediation, and as-built limit checks;
  - `src/conductor/test/engine/adr-decision-corpus.test.ts`, the whole file;
  - `artifacts.test.ts` › "accepts every ADR in the repository corpus";
  - `kpi-report.test.ts` › "preserves the parse states of committed reason-free partial and
    pre-Time records".

  A shared measurement helper, `src/conductor/test/corpus/corpus-admission.ts`, replaces the three
  copies of `largestCorpusBytes`, `largestPlanIntentBytes`, and `largestPlanTasksBytes`. Each
  measure returns `{ bytes, path }`. `corpusAdmissionFailures(entries)` returns one message per
  entry whose measured bytes exceed its limit:
  `<dimension>: largest live input <path> is <bytes> B, over the shipped limit <limit> B`.
  Tests assert that list `toEqual([])`, so a failure prints every offending dimension, path, size,
  and limit.
- **CI job.** Add a `docs-corpus` job to `.github/workflows/ci.yml`:
  - `needs: changes`, with `if: needs.changes.outputs.docs_only == 'true'`;
  - checkout, setup-node, `npm ci`, and `npm run build`, copied from the `conductor` job;
  - then `npm test -- test/corpus/` in `src/conductor`. Vitest's positional filter runs only test
    files whose path contains `test/corpus/`, confirmed in the Vitest filtering docs.

  `ci-gate` adds `docs-corpus` to `needs`, a `DOCS_CORPUS` env, the summary, and the
  `failure|cancelled` loop. A non-docs-only PR skips this job, and its full suite runs the tier.
  `skipped` already satisfies `ci-gate`.
- **Structural guard.** `src/conductor/test/structural/docs-corpus-ci-wiring.test.ts` follows the
  `jobBlock` pattern in `src/conductor/test/structural/ci-progress-wiring.test.ts`. It exports and
  tests a pure `docsCorpusWiringGaps(workflowText)` that names each missing piece of wiring, and it
  executes `ci-gate`'s `run` script under bash with chosen env results. It parses `ci.yml` with
  `js-yaml`, which the repository already depends on.
- **Rejected alternatives** (recorded in the complexity artifact):
  - admission-only, which leaves genuine overflow unseen until main;
  - the full suite on every `.docs/` PR, which is costly;
  - a `compose land` limit gate alone, which misses hand-made docs PRs and the ADR-corpus checks.

## Prerequisites

- None.

## Tasks

### Task 1: Live-corpus tier measurement and admission helper
**Story:** Story 1 (negative paths 1–2)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/corpus/corpus-admission.test.ts`. Each one builds a temporary repository-shaped fixture under `tmpdir()`, registered for cleanup the way existing tests do it, and calls the helpers:
   (a) a `.docs/coherence/` fixture whose largest file is one byte over a supplied limit makes `corpusAdmissionFailures([{ dimension: 'coherence', measure, limit }])` return exactly one message, and that message contains `coherence`, the file's repo-relative path, its byte size, and the limit;
   (b) a `.docs/plans` fixture whose largest serialized task section, measured by `largestPlanTasksBytes`, is over a supplied limit returns exactly one message naming `tasks`, the plan path, the measured size, and the limit;
   (c) a fixture whose every largest input equals its limit returns `[]`.
2. Verify RED: the module does not exist yet.
3. Implement `src/conductor/test/corpus/corpus-admission.ts`:
   - `largestMarkdownBytes(dir)`: recursive `.md`, whole-file UTF-8 bytes, as in the existing `largestCorpusBytes`;
   - `largestPlanIntentBytes(dir)`: first non-empty line of `## Technical Approach`, as in `prd-audit-projection.test.ts`;
   - `largestPlanTasksBytes(dir)`: `JSON.stringify` of `{ id, title, doneWhen }` from `parsePlanTaskTitles`/`parsePlanTaskDoneWhen`, as in `remediation-projection.test.ts`;
   - `corpusAdmissionFailures(entries)`.

   Each measure returns `{ bytes, path }`, where `path` is the largest file's path. Measurement semantics must stay byte-identical to the current copies, so the recorded maxima stay comparable.
4. Verify GREEN; commit "test(corpus): add live-corpus admission helper".

**Done when:**
- [test] `corpus-admission.test.ts` asserts `corpusAdmissionFailures` returns exactly one message containing `coherence`, the oversized fixture file's path, its byte size, and the limit when a `.docs/coherence/` fixture file is one byte over the supplied limit.
- [test] `corpus-admission.test.ts` asserts `corpusAdmissionFailures` returns exactly one message containing `tasks`, the plan path, the measured serialized task-section size, and the limit when a `.docs/plans` fixture exceeds the supplied tasks limit.
- [test] `corpus-admission.test.ts` asserts `corpusAdmissionFailures` returns `[]` when every measured largest input equals its limit.
- `largestMarkdownBytes`, `largestPlanIntentBytes`, and `largestPlanTasksBytes` in `src/conductor/test/corpus/corpus-admission.ts` compute the same byte counts as the copies they replace and return the largest file's path with each count.

**Files likely touched:**
- `src/conductor/test/corpus/corpus-admission.ts` — shared live-corpus measures and admission check
- `src/conductor/test/corpus/corpus-admission.test.ts` — fixture tests for the helper

**Dependencies:** none

### Task 2: PRD-audit limit check asserts admission; maxima re-recorded from the corpus at BUILD
**Story:** Story 1 (happy paths 1, 3, 4; negative paths 1, 3)
**Type:** happy-path

**Steps:**
1. Move "ships finite corpus-based limits that admit every normal input and its total envelope" out of `src/conductor/test/engine/prd-audit-projection.test.ts` into a new `src/conductor/test/corpus/prd-audit-projection-limits.test.ts`. Delete the now-unused local helpers `largestCorpusBytes` and `largestPlanIntentBytes` from the old file only if nothing else there uses them. Resolve the repository root from the new file's location; `test/corpus/` has the same depth as `test/engine/`.
2. In the moved test, replace `expect(maxima).toEqual({ … live … })`. The new assertion is `expect(corpusAdmissionFailures([...])).toEqual([])` over five entries, each measured with the Task 1 helpers against `PRD_AUDIT_PROJECTION_LIMITS`:
   - plan-intent, from `.docs/plans` with `largestPlanIntentBytes`, against `planIntentBytes`;
   - plan-tasks, from `.docs/plans` with `largestMarkdownBytes`, against `planTasksBytes`;
   - criteria, from `.docs/stories`, against `criteriaBytes`;
   - prd-intent, from `.docs/specs`, against `prdIntentBytes`;
   - coherence, from `.docs/coherence`, against `coherenceBytes`.

   Keep the finite/positive check and every `roundUpPowerOfTwo` derivation assertion, including `totalBytes`, unchanged.
3. Verify RED against the current corpus. The coherence entry fails because `.docs/coherence/a-change-to-one-stacked-child-cannot-be-carried-in.md` (68,397 B) exceeds 65,536. If main has been hot-fixed meanwhile, record that the admission check already passes, and rely on Task 1's fixture RED instead.
4. In `src/conductor/src/engine/prd-audit-projection.ts`, set each `PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES` entry to the value measured from the live corpus at BUILD. For every changed entry, add a comment beside it naming the source artifact path and byte size, in the style of the comments on `REMEDIATION_PROJECTION_COMPONENT_LIMITS`. Update the doc comment to say the maxima are a BUILD-time snapshot and that the live-corpus tier enforces admission. Do not change floors, the derivation, or `historyBytes`.
5. Verify GREEN; commit "fix(prd-audit): assert corpus admission and re-record maxima".

**Done when:**
- [test] `prd-audit-projection-limits.test.ts` asserts `corpusAdmissionFailures` is `[]` for the live plan-intent, plan-tasks, criteria, prd-intent, and coherence inputs against `PRD_AUDIT_PROJECTION_LIMITS`, and the file contains no equality assertion between `PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES` and the live corpus.
- [test] `prd-audit-projection-limits.test.ts` asserts every `PRD_AUDIT_PROJECTION_LIMITS` component and `totalBytes` is finite, positive, and `toBe` its `roundUpPowerOfTwo` derivation from the recorded maxima, the 256 KiB floors, the history floor, the 512 KiB diff cap, and the envelope overhead, so a limit changed away from that derivation fails the test.
- `PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES` in `src/conductor/src/engine/prd-audit-projection.ts` holds the largest live inputs measured at BUILD with each changed entry's source path and byte size in an adjacent comment, so `coherenceBytes` is at least 68,397 and the derived coherence limit admits that file.
- [test] `src/conductor/test/corpus/prd-audit-projection-limits.test.ts`, inside the live-corpus tier that the `docs-corpus` job runs, builds its coherence entry through `corpusAdmissionFailures`, so a live coherence file over `PRD_AUDIT_PROJECTION_LIMITS.coherenceBytes` fails the check with a message naming `coherence`, the file path, its measured size, and the limit.
- The moved test title no longer appears in `src/conductor/test/engine/prd-audit-projection.test.ts`, and that file's remaining tests pass unchanged.

**Files likely touched:**
- `src/conductor/test/corpus/prd-audit-projection-limits.test.ts` — moved, admission-shaped limit check
- `src/conductor/test/engine/prd-audit-projection.test.ts` — limit check and unused helpers removed
- `src/conductor/src/engine/prd-audit-projection.ts` — re-recorded maxima with source comments

**Dependencies:** Task 1

### Task 3: Remediation limit check asserts admission
**Story:** Story 1 (happy paths 2, 4; negative paths 2, 3)
**Type:** happy-path

**Steps:**
1. Move "ships finite corpus-sized structured limits and a total envelope" out of `src/conductor/test/engine/remediation-projection.test.ts` into a new `src/conductor/test/corpus/remediation-projection-limits.test.ts`. Remove the old file's local `largestPlanTasksBytes` helper if nothing else there uses it.
2. Replace `expect(REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.tasksBytes).toBe(await largestPlanTasksBytes(...))` with `expect(corpusAdmissionFailures([{ dimension: 'tasks', measure: largestPlanTasksBytes(.docs/plans), limit: REMEDIATION_PROJECTION_LIMITS.tasksBytes }])).toEqual([])`. Keep every existing finite/positive and derivation assertion, including `totalBytes`, unchanged.
3. Verify GREEN. The relaxation's RED is owned by Task 1's tasks-overflow fixture. Commit "test(remediation): assert corpus admission for plan tasks".

**Done when:**
- [test] `remediation-projection-limits.test.ts` asserts `corpusAdmissionFailures` is `[]` for the live largest serialized plan task section against `REMEDIATION_PROJECTION_LIMITS.tasksBytes`, and the file contains no equality assertion between `REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.tasksBytes` and the live corpus.
- [test] `remediation-projection-limits.test.ts` asserts every `REMEDIATION_PROJECTION_LIMITS` entry is finite, positive, and `toBe` its documented `roundUpPowerOfTwo` derivation from the recorded maxima, floors, and envelope overhead, so a limit changed away from that derivation fails the test.
- [test] `remediation-projection-limits.test.ts` builds its tasks entry through `corpusAdmissionFailures`, so a live plan whose serialized task section exceeds `REMEDIATION_PROJECTION_LIMITS.tasksBytes` fails the check with a message naming `tasks`, the plan path, its measured size, and the limit.
- The moved test title no longer appears in `src/conductor/test/engine/remediation-projection.test.ts`, and that file's remaining tests pass unchanged.

**Files likely touched:**
- `src/conductor/test/corpus/remediation-projection-limits.test.ts` — moved, admission-shaped limit check
- `src/conductor/test/engine/remediation-projection.test.ts` — limit check and unused helper removed

**Dependencies:** Task 1

### Task 4: Move the remaining live-corpus checks into the tier
**Story:** Story 2 (happy path 3; negative path 2)
**Type:** refactor

**Steps:**
1. Move `src/conductor/test/as-built-projection.test.ts` › "keeps the largest plan, stories, and governing-ADR decision corpus inputs within shipped byte limits" into `src/conductor/test/corpus/as-built-projection-limits.test.ts`. Rewrite it to assert that `corpusAdmissionFailures` is `[]` for plans, stories, and decisions, measured with `largestMarkdownBytes`, against `AS_BUILT_PROJECTION_LIMITS.planTasksBytes`, `.storyCriteriaBytes`, and `.governingAdrDecisionsBytes`. Keep its finite-number shape assertion.
2. `git mv src/conductor/test/engine/adr-decision-corpus.test.ts src/conductor/test/corpus/adr-decision-corpus.test.ts`. Both directories sit at the same depth, so the `REPOSITORY_ROOT` URL and the `../../src/...` imports stay valid; confirm by running the file. Keep its existing `// Covers:` lines.
3. Move `src/conductor/test/engine/artifacts.test.ts` › "accepts every ADR in the repository corpus" into `src/conductor/test/corpus/adr-approval-corpus.test.ts`, importing `adrApprovalStatus` from `../../src/engine/artifacts.js`.
4. Move `src/conductor/test/engine/kpi-report.test.ts` › "preserves the parse states of committed reason-free partial and pre-Time records" into `src/conductor/test/corpus/kpi-shipped-records.test.ts`.
5. Remove helpers and imports left unused in the source files. Run each new tier file and each edited source file. Commit "test(corpus): gather live-corpus checks into test/corpus".

**Done when:**
- [test] `as-built-projection-limits.test.ts` asserts `corpusAdmissionFailures` is `[]` for the live largest plan, stories, and decisions files against the corresponding `AS_BUILT_PROJECTION_LIMITS` entries.
- [test] `src/conductor/test/corpus/adr-decision-corpus.test.ts`, `adr-approval-corpus.test.ts`, and `kpi-shipped-records.test.ts` pass against the live corpus, and the ADR decision-corpus test still fails on an APPROVED ADR whose numbered decision is uncitable, because its assertions are unchanged.
- Each moved test title occurs exactly once under `src/conductor/test`, only inside `src/conductor/test/corpus/`, and `src/conductor/test/engine/adr-decision-corpus.test.ts` no longer exists.
- `src/conductor/test/as-built-projection.test.ts`, `src/conductor/test/engine/artifacts.test.ts`, and `src/conductor/test/engine/kpi-report.test.ts` pass with their remaining tests unchanged.

**Files likely touched:**
- `src/conductor/test/corpus/as-built-projection-limits.test.ts` — moved as-built admission check
- `src/conductor/test/corpus/adr-decision-corpus.test.ts` — moved from `test/engine/`
- `src/conductor/test/engine/adr-decision-corpus.test.ts` — moved away
- `src/conductor/test/corpus/adr-approval-corpus.test.ts` — moved ADR approval-corpus check
- `src/conductor/test/corpus/kpi-shipped-records.test.ts` — moved pinned shipped-record check
- `src/conductor/test/as-built-projection.test.ts` — corpus check removed
- `src/conductor/test/engine/artifacts.test.ts` — corpus check removed
- `src/conductor/test/engine/kpi-report.test.ts` — pinned shipped-record check removed

**Dependencies:** Task 1

### Task 5: Docs-only CI job runs the tier and gates `ci-gate`
**Story:** Story 2 (happy paths 1–4; negative paths 1–4)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/structural/docs-corpus-ci-wiring.test.ts`. Reuse the `jobBlock(workflow, job)` slicing pattern from `src/conductor/test/structural/ci-progress-wiring.test.ts`. Export and test a pure `docsCorpusWiringGaps(workflowText: string): string[]`, which returns gap names from `job`, `docs-only-condition`, `tier-selection`, `ci-gate-needs`, and `ci-gate-result`. The checks are:
   - `job`: a `docs-corpus` job exists;
   - `docs-only-condition`: its `if:` is exactly `needs.changes.outputs.docs_only == 'true'`;
   - `tier-selection`: it runs `npm test -- test/corpus/` with `working-directory: src/conductor`;
   - `ci-gate-needs`: `ci-gate.needs` includes `docs-corpus`;
   - `ci-gate-result`: `ci-gate`'s env maps `DOCS_CORPUS: ${{ needs.docs-corpus.result }}`, and its loop iterates `"$DOCS_CORPUS"`.

   Assertions:
   (a) the real `.github/workflows/ci.yml` yields `[]`;
   (b) five mutated copies, each with one piece of wiring removed, each yield exactly that one gap name;
   (c) `src/conductor/test/corpus/` holds at least one `*.test.ts`, with a failure message saying the tier is empty;
   (d) the default `vitest.config.ts` `include` matches, and its `exclude` does not exclude, every tier file;
   (e) parse `ci.yml` with `js-yaml`, take the `ci-gate` job's `run` script, and run it with `bash -c` and an env where every result is `success` or `skipped`: it exits 0. Run it again with only `DOCS_CORPUS=failure`, then only `DOCS_CORPUS=cancelled`: each exits 1;
   (f) the `conductor` job's `if:` is still `needs.changes.outputs.docs_only != 'true'`, and its test step is unchanged.
2. Verify RED: the job does not exist yet.
3. Implement in `.github/workflows/ci.yml`:
   - add a `docs-corpus` job: `needs: changes`; `if: needs.changes.outputs.docs_only == 'true'`; `runs-on: ubuntu-latest`; `timeout-minutes: 10`; then checkout `fetch-depth: 0`, setup-node, and `npm ci`/`npm run build`, the same steps as `conductor`; then `npm test -- test/corpus/` with `working-directory: src/conductor`;
   - add a comment explaining that docs-only PRs skip `conductor`, so this tier is their only check against the live corpus;
   - in `ci-gate`, add `docs-corpus` to `needs`, `DOCS_CORPUS` to `env`, `docs_corpus=$DOCS_CORPUS` to the summary, and `"$DOCS_CORPUS"` to the loop.
4. Verify GREEN; commit "ci: run the live-corpus tier on docs-only pull requests".

**Done when:**
- [test] `docs-corpus-ci-wiring.test.ts` asserts `docsCorpusWiringGaps` returns `[]` for the real `.github/workflows/ci.yml`, whose `docs-corpus` job runs `npm test -- test/corpus/` in `src/conductor` only when `needs.changes.outputs.docs_only == 'true'`, while the `conductor` job keeps `if: needs.changes.outputs.docs_only != 'true'` and its unchanged full-suite step.
- [test] `docs-corpus-ci-wiring.test.ts` asserts each of five mutated workflows yields exactly its one gap name among `job`, `docs-only-condition`, `tier-selection`, `ci-gate-needs`, and `ci-gate-result`.
- [test] `docs-corpus-ci-wiring.test.ts` runs the parsed `ci-gate` `run` script under bash and asserts exit 0 when every result is `success` or `skipped`, and exit 1 when `DOCS_CORPUS` alone is `failure` and when it alone is `cancelled`, so a failing live-corpus job on a docs-only PR fails `ci-gate`.
- [test] `docs-corpus-ci-wiring.test.ts` asserts `src/conductor/test/corpus/` contains at least one `*.test.ts`, failing with a tier-is-empty message otherwise, and that the default `vitest.config.ts` `include` covers and its `exclude` does not exclude every tier file, so the full suite runs each tier check once.

**Files likely touched:**
- `.github/workflows/ci.yml` — `docs-corpus` job and `ci-gate` wiring
- `src/conductor/test/structural/docs-corpus-ci-wiring.test.ts` — wiring, gate-script, and tier tests

**Dependencies:** Task 1

### Task 6: Test-authoring guidance names the live-corpus tier
**Story:** Story 2 (Done When: test-authoring guidance)
**Type:** infrastructure

**Steps:**
1. In `.agents/skills/write-tests/SKILL.md`, add a short rule under "## 8. Verify with CI parity":
   - A test whose verdict depends on the live repository `.docs/` corpus belongs in `src/conductor/test/corpus/`, because docs-only pull requests run only that tier.
   - A projection-limit check in that tier asserts that the shipped limits admit the corpus, never equality with a recorded snapshot.
   - Add the same item to the completion checklist.
2. This is agent guidance with no executable behavior; no wording-match test is added. Commit "docs(write-tests): route live-corpus tests to the corpus tier".

**Done when:**
- `.agents/skills/write-tests/SKILL.md` section 8 states that a test whose verdict depends on the live `.docs/` corpus belongs in `src/conductor/test/corpus/`, and that a projection-limit check there asserts admission rather than equality with recorded maxima.
- `.agents/skills/write-tests/SKILL.md`'s completion checklist carries a matching item.

**Files likely touched:**
- `.agents/skills/write-tests/SKILL.md` — live-corpus tier rule and checklist item

**Dependencies:** none

## Task Dependency Graph

```
Task 1 ──┬──> Task 2
         ├──> Task 3
         ├──> Task 4
         └──> Task 5
Task 6 (independent)
```

## Integration Points

- After Task 4: `npm test -- test/corpus/` in `src/conductor` runs the complete live-corpus tier.
- After Task 5: a docs-only PR runs that tier, and `ci-gate` reports it.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the live `.docs/` corpus gains a coherence file larger than the recorded PRD-audit coherence maximum but no larger than the shipped coherence limit, when the PRD-audit projection limit check runs, then it passes. | 2 | "asserts `corpusAdmissionFailures` is `[]` for the live plan-intent, plan-tasks, criteria, prd-intent, and coherence inputs against `PRD_AUDIT_PROJECTION_LIMITS`, and the file contains no equality assertion between `PRD_AUDIT_PROJECTION_CORPUS_MAXIMA_BYTES` and the live corpus" | diff-local |
| Story 1 happy: Given the live `.docs/plans` corpus gains a plan whose serialized task section is larger than the recorded remediation tasks maximum but no larger than the shipped remediation tasks limit, when the remediation projection limit check runs, then it passes. | 3 | "the file contains no equality assertion between `REMEDIATION_PROJECTION_CORPUS_MAXIMA_BYTES.tasksBytes` and the live corpus" | diff-local |
| Story 1 happy: Given this feature's BUILD, when the PRD-audit recorded maxima are compared with the live corpus at that BUILD, then every recorded maximum is at least the largest corresponding live input, so each derived limit admits the 68,397-byte coherence file already on main. | 2 | "holds the largest live inputs measured at BUILD with each changed entry's source path and byte size in an adjacent comment, so `coherenceBytes` is at least 68,397 and the derived coherence limit admits that file" | diff-local |
| Story 1 happy: Given the shipped PRD-audit and remediation limits, when the limit checks run, then every component limit and the total envelope are still finite, positive, and equal to their documented derivation from the recorded maxima, floors, and envelope overhead. | 2, 3 | "component and `totalBytes` is finite, positive, and `toBe` its `roundUpPowerOfTwo` derivation" | diff-local |
| Story 1 negative: Given a live `.docs/coherence/` file larger than the shipped PRD-audit coherence limit, when the PRD-audit projection limit check runs, then it fails and its message names the dimension, the measured largest size, and the limit. | 2 | "fails the check with a message naming `coherence`, the file path, its measured size, and the limit" | diff-local |
| Story 1 negative: Given a live `.docs/plans` file whose serialized task section exceeds the shipped remediation tasks limit, when the remediation projection limit check runs, then it fails naming the dimension, the measured size, and the limit. | 3 | "fails the check with a message naming `tasks`, the plan path, its measured size, and the limit" | diff-local |
| Story 1 negative: Given a shipped limit is changed so that it no longer equals its documented derivation from the recorded maxima, floors, and envelope overhead, when the limit check runs, then it fails even though the live corpus is admitted. | 2, 3 | "so a limit changed away from that derivation fails the test" | diff-local |
| Story 2 happy: Given a pull request whose every changed path is under `.docs/`, when CI runs, then a live-corpus job runs exactly the live-corpus test tier and `ci-gate` reports its result. | 5 | "whose `docs-corpus` job runs `npm test -- test/corpus/` in `src/conductor` only when `needs.changes.outputs.docs_only == 'true'`" | diff-local |
| Story 2 happy: Given a pull request that changes any path outside `.docs/`, when CI runs, then the live-corpus job is skipped and the full conductor suite, which still includes the live-corpus tier, runs as before. | 5 | "while the `conductor` job keeps `if: needs.changes.outputs.docs_only != 'true'` and its unchanged full-suite step" | diff-local |
| Story 2 happy: Given the live-corpus tier, when the default conductor suite runs locally or in the `conductor` shards, then every live-corpus check still runs exactly once in that suite. | 4, 5 | "Each moved test title occurs exactly once under `src/conductor/test`, only inside `src/conductor/test/corpus/`" | diff-local |
| Story 2 happy: Given a docs-only pull request whose corpus passes every live-corpus check, when CI completes, then `ci-gate` is satisfied. | 5 | "asserts exit 0 when every result is `success` or `skipped`" | diff-local |
| Story 2 negative: Given a docs-only pull request that adds a coherence file larger than the shipped PRD-audit coherence limit, when CI runs, then the live-corpus job fails and `ci-gate` fails on that pull request. | 2, 5 | "inside the live-corpus tier that the `docs-corpus` job runs, builds its coherence entry through `corpusAdmissionFailures`" | diff-local |
| Story 2 negative: Given a docs-only pull request that adds an APPROVED ADR whose numbered decision cannot be cited, when CI runs, then the live-corpus job fails and `ci-gate` fails on that pull request. | 4, 5 | "the ADR decision-corpus test still fails on an APPROVED ADR whose numbered decision is uncitable, because its assertions are unchanged" | diff-local |
| Story 2 negative: Given the CI workflow loses the live-corpus job, its docs-only condition, its `ci-gate` dependency, or its tier selection, when the structural CI wiring test runs, then it fails naming the missing wiring. | 5 | "asserts each of five mutated workflows yields exactly its one gap name among `job`, `docs-only-condition`, `tier-selection`, `ci-gate-needs`, and `ci-gate-result`" | diff-local |
| Story 2 negative: Given the live-corpus tier directory contains no test files, when the structural CI wiring test runs, then it fails rather than letting the job pass vacuously. | 5 | "asserts `src/conductor/test/corpus/` contains at least one `*.test.ts`, failing with a tier-is-empty message otherwise" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
