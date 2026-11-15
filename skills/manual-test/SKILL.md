---
name: manual-test
disable-model-invocation: true
description: "Use to validate stories via curl (API) or browser (full-stack) after the test suite and before /finish. Browser capability gaps warn; observed bugs loop back through /tdd."
enforcement: gating
phase: ship
standalone: false
requires: [verify-claims]
---

## Purpose

Validates that implemented stories actually work by exercising the running application.
Automated tests verify code correctness; manual testing verifies the system works end-to-end
as a user would experience it.

**Correctness gate:** a "story X passes" result is a claim. Per the `/verify-claims` protocol, a
pass is `verified` — you actually observed the response/behavior — never assumed from the code or
inferred from a green unit test. If a story was not actually exercised, do not claim it passed;
report it as untested rather than presenting an assumption as a result.

## Practices

### 0. Feature Type Check

Before starting manual testing, check the stories in `.docs/stories/` for this feature:
- If **no stories reference HTTP endpoints, API routes, or user-facing UI**, report SKIP:
  "Manual test skipped — feature has no endpoint/UI criteria (services, jobs, mailers, CI)."
- Suggest console-based verification instead: `rails console` smoke test or script execution.
- Display the skip reason to the user, then **record it via the CLI** — this is the sole
  way the step is marked done; there is no hand-written marker path:
  ```
  ai-conductor manual-test-record --skip --reason "<reason>"
  ```
  Run this from the feature worktree. `--pipeline-dir <absolute path>` is an optional override.

### 1. Detect Project Type

| Indicator | Testing Method |
|---|---|
| API-only (no views) | `curl` commands against running server |
| Full-stack (views exist) | Browser automation via Chrome MCP or Capybara |

For a full-stack project, verify that the already-configured browser driver and browser runtime
are available and can launch before exercising browser criteria. **Do not install browser packages,
binaries, or system dependencies during `manual-test`/SHIP.**

- If the browser driver, browser binary, or required launch capability is missing or cannot start,
  record each affected browser criterion as `WARN`. Include the exact dependency/launch error and a
  concrete recovery command in Notes, then continue exercising any API criteria with `curl`.
- A `WARN` is non-blocking capability evidence. It does not enter the bug loop or route back to BUILD.
- Once a browser session launches, an observed mismatch between expected and actual application
  behavior is `FAIL`, even if other criteria are `WARN`. Do not relabel an application failure as an
  environment warning.

### 2. Start the Application

Ensure the application is running and accessible:

**Rails:**
```bash
# Start server in background
bin/rails server -d -p 3000
# Or if using Docker:
docker compose up -d
```

**Node:**
```bash
npm start &
# Or: npm run dev &
```

**Always stop and restart the server before testing.** A stale server from a prior session
runs old code and gives false results. Kill any existing server process, then start fresh:

```bash
# Kill existing server (check common ports)
lsof -ti:3000 | xargs kill -9 2>/dev/null || true  # Rails
lsof -ti:8000 | xargs kill -9 2>/dev/null || true  # FastAPI/Django
lsof -ti:5173 | xargs kill -9 2>/dev/null || true  # Vite

# Start fresh
```

After starting, verify it's up: `curl -s http://localhost:3000/up` (or health check endpoint).

### 3. Walk Through Stories (API Projects)

For each story in `.docs/stories/`, execute the acceptance criteria manually using `curl`:

```bash
# Story: Create a short link (happy path)
curl -s -X POST http://localhost:3000/links \
  -H "Content-Type: application/json" \
  -d '{"link": {"original_url": "https://example.com"}}' | python3 -m json.tool

# Story: Expired link returns 410 (negative path)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/abc123
# Expected: 410
```

**For each story, record:**

| Story | Criterion | Expected | Actual | Result |
|---|---|---|---|---|
| Create link | 201 with short_code | 201 + 6-char code | 201 + "xK9mR2" | PASS |
| Expired link | 410 Gone | 410 | 410 | PASS |
| Invalid URL | 422 with error | 422 | 500 Internal Server Error | **FAIL** |

### 4. Walk Through Stories (Full-Stack Projects)

Use browser automation (Chrome MCP if configured, otherwise manual Capybara-style):

1. Navigate to each page referenced in stories
2. Perform the actions described in Given/When/Then
3. Verify visible output matches expected behavior
4. Take screenshots of key states as manual-test evidence

### 5. Display Results

Display results to the user in the conversation, then **record them via the CLI** —
`manual-test-record` is the sole intended writer of `.pipeline/manual-test-results.md`;
do not hand-write or append to that file yourself. The conductor's completion gate reads
this file to verify manual-test ran for the current feature — without it, the step has no
objective on-disk evidence and cannot pass.

From the feature worktree, record the run by piping (or pointing at) the results content:

```
ai-conductor manual-test-record --results - <<'EOF'
<results table + bugs section, in the format below>
EOF
```

or, if the results were written to a file first:

```
ai-conductor manual-test-record --results /path/to/results.md
```

Supply only the current attempt's table and bug list; the CLI adds the `## Attempt N` header and
timestamp, appends, and never truncates earlier attempts.

`--pipeline-dir <absolute path>` remains an optional override when recording outside the feature
worktree; never pass a relative pipeline path.

Use this format for the content you pass to `--results` (both in chat and to the CLI):

```
# Manual Test Results
**Server:** localhost:3000
**Tester:** Claude (automated curl) / User (browser)

## Attempt 1 — 2026-07-06T10:00:00Z

| Story | Criterion | Result | Notes |
|---|---|---|---|
| ... | ... | PASS/FAIL/WARN | ... |

### Bugs Found
1. **BUG-001:** Invalid URL returns 500 instead of 422 (story: create-link, negative path: invalid input)
2. **BUG-002:** ...
```

If the record command exits non-zero, do NOT consider manual_test complete and never hand-write the
results file; report the command's error output as the blocker.

**Whitewash guard (#367):** after a recorded `FAIL`, a later attempt with no `FAIL` rows (PASS
and/or WARN) is accepted only if new commits exist since the failure, so the Step C fix MUST land as
commits before the re-verify attempt. `WARN` rows do not block the gate.

### 6. Bug Loop

**Any FAIL result becomes a bug that loops back through `/tdd`. WARN results do not:**

**Step A — Confirm the buggy code path is supposed to exist** (the `/debugging` Phase 4
GATE). Manual-test surfaces defects on *shipped* code — read the governing APPROVED ADR/PRD for
the affected component first. If the buggy path violates or is superseded by an approved
decision, the fix is a **conformance finding (kickback), not a patch** — a bug on a condemned
path is a removal signal. This cheap design check precedes the expensive RED→fix→suite cycle.

**Step B — If the cause is not obvious, discover it before fixing.** A manual FAIL gives you the
*symptom* (e.g. "500 instead of 422"), not the *cause*. When you cannot point to the root cause
with confidence from the failure alone, do NOT guess a fix or a reproducing test — dispatch the
`/debugging` protocol (root cause before fix; no fixes without evidence) in a fresh sub-session,
handing it the failing story, the observed-vs-expected result, and any server output/logs. Come
back with an evidence-backed root cause, then proceed. Skip this step only when the cause is
genuinely self-evident from the failure.

**Step C — Fix via TDD, now that the cause is known:**
1. Write a failing test that reproduces the bug at the right layer (RED)
2. Fix it (GREEN)
3. Commit
4. Re-run the manual test for that story to verify

**Do NOT proceed to `/finish` with known bugs.** The manual test gate must be clean.

### 7. Shut Down

Stop the application server after testing:

```bash
# Rails
kill $(cat tmp/pids/server.pid)
# Docker
docker compose down
```

## Verification

- [ ] Application started and accessible
- [ ] Every story (happy + negative paths) tested manually
- [ ] Results displayed to user
- [ ] Browser automation availability was checked without installing dependencies; unavailable or
      unlaunchable browser criteria were recorded as WARN with the error and recovery command
- [ ] Every exit path (Step 0 SKIP or Step 5 real-run PASS/FAIL/WARN) ended by actually invoking
      `ai-conductor manual-test-record` (`--skip --reason ...` or `--results ...`) from the
      feature worktree — not a hand-written or fabricated marker
- [ ] All bugs fixed via TDD loop
- [ ] Re-verification passed after bug fixes
- [ ] Application shut down cleanly
