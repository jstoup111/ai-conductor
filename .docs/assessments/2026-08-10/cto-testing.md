# Test Strategy Review

**Date:** 2026-08-10
**Scope:** `src/conductor/test/**` (765 vitest files across acceptance/, integration/, engine/, execution/, cli/, ui/, structural/, smoke/, fixtures/, types/), `test/test_harness_integrity.sh` + `test/lint_shell.sh`, `vitest.config.ts`, `test/setup.ts`, `HARNESS.md` test-isolation policy, `.agents/skills/write-tests/SKILL.md`.

**Method disclosure:** Suite was NOT executed (per instructions — no node_modules, no npm/vitest run). All findings are from reading test source, config, and source files. No coverage percentage is stated anywhere in this report because none was measured.

---

## 1. Coverage Gaps

Not done as a full source↔test cross-reference (~400k LOC, out of scope to enumerate exhaustively at this effort level). Targeted check on the highest-risk file named in scope:

| Source File | Expected Test File | Has Test? | File Type | Severity |
|---|---|---|---|---|
| `src/engine/engineer/intake/ledger.ts` | `test/engine/engineer/intake/ledger.test.ts` + `ledger.acceptance.test.ts` | Yes (both exist) | Coordinator (sole dedup authority per file's own header comment) | See §5 — tests exist but miss the two failure modes that matter |

**Gap count:** not exhaustively measured; spot check found no gap on the one file in scope. **Confidence: verified** for this one file; the general "no gaps elsewhere" claim is not asserted.

---

## 2. Test Layer Balance

| Layer | Count (files) | Notes |
|---|---|---|
| `test/engine/**` (unit-ish, largest) | 469 | Mix of true unit and engine-level integration; not separated by directory convention |
| `test/acceptance/**` | 154 | Second-largest tier |
| `test/integration/**` | 41 | |
| `test/execution/**` | 15 | Provider adapter contract tests |
| `test/ui/**` | 14 | |
| top-level `test/*.test.ts` (uncategorized) | ~54 | Wiring/kickback/daemon-cli glue tests living outside any tier directory |
| `test/cli/**` | 5 | |
| `test/structural/**` | 5 | Policy/lint-as-code |
| `test/smoke/**` + `*.smoke.test.ts` | 3 in `test/smoke/` + ~10 more `*.smoke.test.ts` scattered by feature dir (e.g. `execution/claude-provider.smoke.test.ts`, `engine/daemon-e2e-live.smoke.test.ts`) | Opt-in, excluded from default run |
| `test/types/**` | 2 | |
| `test/fixtures/**` | 3 test files + shared fixture helpers | |
| **Total** | **765** | (find count over `test/**/*.test.ts`) |

**Balance assessment:** Skewed toward engine/acceptance, not unit — but not unhealthy for this project shape. **Basis: verified** (counts via `find`).

**Explanation:** `engine/` (469) and `acceptance/` (154) together are ~81% of the suite. This is not the classic "inverted pyramid" anti-pattern for a *web app*, because this codebase is an orchestration engine, not a CRUD app — most of `engine/` is single-module/single-function tests (unit-shaped) that happen to live in a flat `engine/` directory rather than a `unit/` one, so the raw count overstates how "heavy" the tier actually is. The real risk is different: acceptance tests (154, `Conductor.run()`-level per `write-tests` SKILL.md §2-3) are the tier most likely to be slow/flaky, and `slowTestThreshold=1800000` (30 minutes) in `package.json`'s `test` script (verified) means a genuinely slow acceptance test — the kind `write-tests` SKILL.md §5 says should fail as "a defect signal, not a performance budget" — will not be surfaced as slow by vitest's own reporter. Combined with the stated target of "under five minutes, expected two to three" for the aggregate suite (write-tests SKILL.md §8), the 30-minute threshold looks like it was raised to silence a known-slow outlier rather than fix it. **Confidence: 70%, inferred** (the threshold value is verified; the reason it was set that high is inferred from the surrounding policy text, not confirmed by a commit message or comment in the config itself — vitest.config.ts has no comment explaining the number).

---

## 3. Assertion Quality

Spot-checked `test/engine/halt-pr-reconciliation.test.ts` and `test/engine/engineer/intake/ledger.test.ts` in depth (read in full) plus targeted greps elsewhere.

| Finding | Severity | File:Line | Issue |
|---|---|---|---|
| Strong: state-based, not call-based, assertions | — (positive) | `test/engine/engineer/intake/ledger.test.ts:125-139` | `requeueClaimed` test asserts on resulting entry state (`status`, `capturedAt`, `attempts`, `lastSeenAt`) and the returned `{acted}` value — behavior, not implementation. **Verified.** |
| Strong: fake models failure, not just success | — (positive) | `test/engine/halt-pr-reconciliation.test.ts:177-193` | A `failingGh` fake throws `'network error: connection timeout'`; test asserts the reconciler logs `'failed to enumerate PRs'` rather than crashing. **Verified.** |

No fabricated bad examples included — I did not find a large enough sample of `not_to be_nil`-style weak assertions or heavy over-mocking in the files actually read to report specific file:line findings at this effort level. **This section is a partial sample, not a suite-wide audit** — treat absence of findings here as "not found in the files inspected," not "suite-wide clean."

---

## 4. Fragile Tests

| Finding | Severity | File:Line | Fragility Type |
|---|---|---|---|
| `vitest.config.ts` `slowTestThreshold=1800000` masks slow-test signal | important | `src/conductor/package.json` `"test"` / `"test:changed"` scripts (verified); cross-referenced against `write-tests` SKILL.md §5, §8 (5-min budget) | Not a per-test fragility, but a suite-health-signal defect: a test that silently regresses to minutes-long runtime produces no reporter warning before the aggregate 5-minute wall is hit. **Confidence: 85%, verified** for the value; **inferred** for its consequence since the suite was not run. |
| No coverage of `intake/ledger.ts` corruption/concurrency paths | critical | `test/engine/engineer/intake/ledger.test.ts` (whole file, verified by full read) + `ledger.acceptance.test.ts` (whole file, verified by full read) | See §5 — not "fragile" in the classic sense, but a false-confidence generator: the existing tests pass against the *current, buggy* implementation and would keep passing after either bug is "fixed" only if the fix is a superset of current behavior, i.e. they provide no regression protection for the two known defects. |

No file:line evidence of order-dependence, un-frozen time assertions, or private-method coupling was found in the files read. `write-tests` SKILL.md §5 mandates injected clocks; this is a documented rule, not something I independently verified across the corpus at this effort level.

---

## 5. Missing Negative Paths — the intake/ledger.ts question (explicit answer)

**Would any existing test have caught either of the two critical bugs in `intake/ledger.ts`? No, for both.**

Source read in full: `src/conductor/src/engine/engineer/intake/ledger.ts`. Both bugs are present and unmitigated by any test in `test/engine/engineer/intake/ledger.test.ts` or `ledger.acceptance.test.ts` (both files read in full):

**Bug 1 — silent parse-error data wipe (`loadStore`, ledger.ts:94-102):**
```ts
async function loadStore(path: string): Promise<LedgerStore> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as LedgerStore;
  } catch {
    return {};
  }
}
```
The bare `catch` conflates "file absent" (intended, documented: "Load tolerates a missing file") with "file present but corrupt/truncated/malformed JSON" (unintended — silently treated as an empty ledger). Any subsequent `record()`/`transition()` call then does load→mutate→`saveStore`, which overwrites the corrupted file with a store containing only the new/updated key — destroying every other entry that was in the (unparseable but still full of real data) file. **No test in either ledger test file writes a malformed/corrupt `ledger.json` and asserts on the result** — every test starts from a fresh `mkdtemp` directory with no pre-existing file, so `loadStore`'s `catch` branch is only ever exercised via the "file absent" path, never the "file present but corrupt" path. Grep confirms no test file anywhere under `test/engine/engineer/intake/` writes raw invalid JSON to a ledger path before invoking `createLedger`.

Corroborating evidence that this is a real deviation from the codebase's own established pattern (not just an oversight nobody thought of): `src/engine/state.ts` (a sibling durable-state file) explicitly distinguishes "empty" and "corrupted" as separate tagged error states (`{ error: { type: 'corrupted', message: 'State file is empty' } }`, verified at `state.ts:40-48`) rather than silently defaulting. `ledger.ts` does not follow that pattern.

**Bug 2 — no locking under concurrency (every method in `createLedger`, ledger.ts:122-224):**
Every operation (`record`, `transition`, `forget`, `reopen`, `requeueClaimed`) is `loadStore` → mutate in memory → `saveStore`, with no file lock, no lease, no optimistic-concurrency check (e.g. no compare-and-swap on a version field or mtime). Two concurrent processes (or two concurrent async calls in the same process) racing on the same `ledger.json` will interleave: both load the same on-disk state, both compute an update, and the second `saveStore` clobbers the first's write — a classic lost-update race. **No test exercises this.** Both ledger test files are entirely single-writer, sequential-`await` test bodies; none spins up two concurrent operations against the same ledger path (e.g. `Promise.all([l.record(...), l.record(...)])` on two different keys, which would demonstrate the lost update).

Corroborating evidence this is a known, testable class of bug in this codebase that the team does test for *elsewhere*: `test/acceptance/conduct-state-json-lost-update-conductor-s-whole-o.acceptance.test.ts` (read header, verified) is an explicit lost-update regression test for `conduct-state.json`, and `test/engine/memory-store-concurrency.test.ts` exists as a named concurrency test for a different store. The pattern for testing this exact failure mode is established practice in this repo — it simply was not applied to `intake/ledger.ts`.

**Severity: Critical.** Both are exactly the kind of failure mode `write-tests` SKILL.md's "Avoid false integration tests" (§7) and the CLAUDE.md design principle ("deterministic where possible... never rely on prompt discipline for something machinery can enforce") warn about: passing tests that certify behavior nobody actually wants. **Confidence: 95%, verified** — both bugs read directly from source; both negative tests confirmed absent by full read of both test files plus grep for corruption/concurrency patterns in the directory.

---

## Summary

**Coverage gaps:** 1 targeted check performed (intake/ledger.ts — has tests, but see below); no suite-wide gap count produced.
**Assertion quality findings:** 2 positive examples verified; no negative examples found in the sample read (sample, not audit).
**Fragile tests:** 2 (1 suite-health signal issue, 1 false-confidence issue — the ledger gap, elevated to Critical in §5).
**Missing negative paths:** 2 critical (ledger corruption, ledger concurrency) — both confirmed absent, explicit answer given in §5.

**Verdict: NEEDS_WORK**, with one **CRITICAL** carve-out (intake/ledger.ts negative-path gap).

- The harness has unusually strong *mechanical* test-isolation enforcement for a codebase this size: `test/structural/test-execution-policy.test.ts` is an AST-based structural gate (uses the TypeScript compiler API to walk every non-smoke test file and fail the build if it finds a static call to `exec`/`spawn`/`execa`/etc. targeting `claude`, `codex`, `curl`, `wget`, `npm install/ci`, or `gh <network-op>`) — this is exactly the "machinery over prompt discipline" principle the repo's own CLAUDE.md asks for, applied to test isolation. **Verified** by full read of that file. Its one acknowledged gap (per `write-tests` SKILL.md's own text) is that it only catches *static* string-literal commands — a dynamically assembled argv would evade it; the SKILL.md compensates with a written rule ("Do not hide a real external call behind a variable... or dynamically assembled argv") rather than a second mechanical check, which is itself a residual prompt-discipline dependency the repo's own design principle would flag.
- `test/setup.ts`'s three kill-switches (no real daemon autolaunch, `AI_CONDUCTOR_NO_REAL_EXEC` for the gh/git seam, redirected engineer-signals dir) are global, verified, and match HARNESS.md's stated isolation policy.
- The one concrete, verified, high-confidence finding that should drive immediate action: **`intake/ledger.ts` has two known-critical bugs (silent data wipe on parse error; lost-update race with no locking) and zero test coverage for either.** Both existing test files for this module are well-written for the happy paths they cover (state-based assertions, not implementation-coupled) but never construct a corrupted ledger file or a concurrent-write scenario — even though the exact same class of bug (lost-update on a JSON-file-backed store) is explicitly tested elsewhere in this repo (`conduct-state.json`, `memory-store.ts`), showing the team knows how to write this test and simply didn't apply it here. This is the sharpest available signal that "has tests" is not the same as "tests the failure modes that matter" — closing this specific gap (2 new tests: malformed-JSON-on-disk before first `record()` call; two concurrent `record()`/`transition()` calls racing on the same key) should be the top priority coming out of this review.
