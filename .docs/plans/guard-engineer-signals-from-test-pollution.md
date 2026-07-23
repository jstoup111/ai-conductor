# Implementation Plan: Guard engineer signals from test pollution

**Source-Ref:** jstoup111/ai-conductor#861
**Track:** Technical  **Tier:** S
**Stories:** `.docs/stories/guard-engineer-signals-from-test-pollution.md`

## Approach summary

Three deterministic layers, each mapped to a desired outcome:

1. **Prevent (primary, mechanical):** redirect `$AI_CONDUCTOR_ENGINEER_DIR` to a
   throwaway temp dir for the whole test process, in the existing `test/setup.ts`
   setupFile that already houses process-scoped kill-switch env vars. Because
   `resolveEngineerDir()` backs signals, the authored-ledger, and narratives, one
   redirect covers all real-store writes for every suite — no per-suite discipline.
   Process-scoped, so a concurrent real daemon in another process is untouched
   (ST-1, ST-2).
2. **Detect (fail-closed tripwire):** in the existing `test/global-setup.ts`
   leak-guard harness, snapshot the real store's `"project":"test-project"` line
   count before/after the run; if it increased, throw at teardown naming the delta.
   Keying on the test-project delta (not byte-equality) tolerates legitimate
   concurrent real writes (ST-3, ST-2). New helper module `signals-leak-guard.ts`
   mirrors `pipeline-leak-guard.ts`.
3. **Clean (one-shot, operator-invoked):** a `bin/` maintenance script that
   quarantines existing `test-project` lines into a sibling file, backs up the
   original, and preserves every real / malformed line byte-for-byte (ST-4).

This **adopts** the filer's primary hypothesis (a vitest setup pointing the env at
a temp dir) as the prevention layer, but places it in the existing setupFile rather
than a new file, and **rejects** the filer's weaker "refuse `project:test-project`
in the writer" as the production mechanism (name-based, easy to miss, would also
reject a legitimately-named project). The test-project name-match survives only in
the passive detection tripwire, never in production code.

## Task Dependency Graph

```
T1 (redirect env in setup.ts)
 └─> T2 (RED specs: real store unchanged + concurrent-real preserved)
       └─> T3 (signals-leak-guard.ts module + unit specs)
             └─> T4 (wire guard into global-setup.ts)
                   └─> T5 (quarantine maintenance script + specs)
                         └─> T6 (docs + CHANGELOG + integrity validation)
```

## Tasks

### T1 — Redirect the engineer dir for the test process
- **Dependencies:** none
- In `src/conductor/test/setup.ts`, create a unique temp dir
  (`mkdtempSync(join(tmpdir(), 'ai-conductor-test-engineer-'))`) and set
  `process.env.AI_CONDUCTOR_ENGINEER_DIR` to it **only if not already set**, so a
  suite that intentionally overrides it (e.g. the poisoned-`"undefined"` case) still
  wins.
- Add a header comment explaining this is kill-switch #3 (never write signals to the
  operator's real `~/.ai-conductor/engineer/`), consistent with the existing two.
- Verify tests that save/restore `AI_CONDUCTOR_ENGINEER_DIR` still pass (they save
  the redirected default and restore it), and tests that inject `env`/`home` directly
  into `resolveEngineerDir` are unaffected (they bypass `process.env`).

### T2 — RED acceptance specs for prevention + concurrency
- **Dependencies:** T1
- Add a spec asserting that after running the emission-driving path with the redirect
  active, writes land under the temp dir and the real-store path is not created/appended.
- Add a spec (or documented harness assertion) for ST-2: an appender writing with an
  explicit real dir (simulating a separate process) is unaffected by the test-process
  env, proving the redirect is process-scoped, not global.

### T3 — `signals-leak-guard.ts` module (mirror `pipeline-leak-guard.ts`)
- **Dependencies:** T2
- Add `src/conductor/test/signals-leak-guard.ts` exporting:
  `snapshotEngineerSignals(engineerDir)` → `{ exists, testProjectLineCount }`, and
  `diffEngineerSignals(before, after)` → `{ addedTestProjectLines }`.
- Count lines whose parsed `project === 'test-project'`; skip blank/malformed lines
  (reuse the resilient line-parse convention).
- Unit specs: increased test-project count is detected; legitimate real-project
  additions are ignored; missing/empty file → clean; malformed lines never count.

### T4 — Wire the guard into `global-setup.ts`
- **Dependencies:** T3
- In `test/global-setup.ts` `setup()`, snapshot the **real** engineer dir
  (`resolveEngineerDir({ env: {} })`-style default, i.e. the operator's real store —
  NOT the redirected temp dir) before the run; in teardown, re-snapshot and diff.
- On `addedTestProjectLines > 0`, throw naming the delta, #861, and the redirect
  fix (fail-closed at the point of violation).
- On a snapshot read error, degrade to `console.error` warning (fail-safe; do not
  take down the suite), matching the tmux-guard indeterminate policy.
- Unit-test the throw-vs-warn decision in isolation (exported helper), mirroring
  `applyTeardownDecision`.

### T5 — Quarantine maintenance script
- **Dependencies:** T4
- Add `bin/quarantine-engineer-signals` (Node/tsx or bash-invoking-node) that:
  reads the real `signals.jsonl` (or `$AI_CONDUCTOR_ENGINEER_DIR`), writes a
  timestamped `signals.jsonl.bak-<ts>` backup, partitions lines into kept
  (non-`test-project` and malformed) vs quarantined (`test-project`), rewrites the
  live file with kept lines in original order, appends quarantined lines to
  `signals.jsonl.test-quarantine`, and prints kept/quarantined counts.
- Idempotent and re-runnable; a `--dry-run` prints counts without mutating.
- Add specs over a fixture store proving real + malformed lines are preserved
  byte-for-byte and only `test-project` lines are moved.
- Ensure `bin/*` passes `bash -n` (if bash wrapper) per repo integrity suite.

### T6 — Docs, CHANGELOG, integrity validation
- **Dependencies:** T5
- Add a `CHANGELOG.md` `## [Unreleased]` entry under **Fixed** (tests no longer
  pollute the real engineer store) and **Added** (quarantine maintenance script +
  signals leak guard).
- Document the new script in `docs/daemon-operations.md` (operational cleanup) and
  note the test-hygiene guard where test conventions are described; update
  `src/conductor/README.md` if it enumerates test env vars.
- Run `test/test_harness_integrity.sh` and the conductor vitest suite; confirm the
  new guard passes on a clean run and the real store is unchanged.
- No `settings.json` / `bin/conduct` CLI / hook / skill-symlink surface is touched,
  so no migration block is required (a `bin/` maintenance script is not the
  `bin/conduct` CLI surface); if the release gate's path classifier flags `bin/`,
  add a `.docs/release-waivers/guard-engineer-signals-from-test-pollution.md`
  waiver in the same diff per the repo's migration-gate waiver ADR.

## Out of scope

- No change to the production signal schema, `emitEngineerSignal`, or
  `resolveEngineerDir` behavior — the default remains the real dir for real runs.
- No automatic mutation of the operator's real store by the test suite or daemon;
  cleanup is operator-invoked only.
