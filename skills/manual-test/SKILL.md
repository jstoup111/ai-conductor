---
name: manual-test
description: "Use after /finish to validate stories via curl (API) or browser (full-stack). Bugs found loop back through /tdd."
enforcement: gating
phase: ship
standalone: false
requires: [finish]
---

## Purpose

Validates that implemented stories actually work by exercising the running application.
Automated tests verify code correctness; manual testing verifies the system works end-to-end
as a user would experience it.

**Runs AFTER `/finish` and BEFORE `/retro`.**

## Practices

### 1. Detect Project Type

| Indicator | Testing Method |
|---|---|
| API-only (no views) | `curl` commands against running server |
| Full-stack (views exist) | Browser automation via Chrome MCP or Capybara |

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

Verify it's up: `curl -s http://localhost:3000/up` (or health check endpoint).

**Verify the server matches current code.** A stale server from a prior session will give false
results. Check that expected routes/endpoints exist (e.g., `GET /openapi.json` for FastAPI,
`rails routes` output). If the server is stale, restart it before testing.

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

| Story | Criterion | Expected | Actual | Pass? |
|---|---|---|---|---|
| Create link | 201 with short_code | 201 + 6-char code | 201 + "xK9mR2" | PASS |
| Expired link | 410 Gone | 410 | 410 | PASS |
| Invalid URL | 422 with error | 422 | 500 Internal Server Error | **FAIL** |

### 4. Walk Through Stories (Full-Stack Projects)

Use browser automation (Chrome MCP if configured, otherwise manual Capybara-style):

1. Navigate to each page referenced in stories
2. Perform the actions described in Given/When/Then
3. Verify visible output matches expected behavior
4. Take screenshots of key states for the retro

### 5. Record Results

Write results to `.docs/manual-test-results.md`:

```markdown
# Manual Test Results
**Date:** YYYY-MM-DD
**Server:** localhost:3000
**Tester:** Claude (automated curl) / User (browser)

## Results

| Story | Criterion | Result | Notes |
|---|---|---|---|
| ... | ... | PASS/FAIL | ... |

## Bugs Found
1. **BUG-001:** Invalid URL returns 500 instead of 422 (story: create-link, negative path: invalid input)
2. **BUG-002:** ...
```

### 6. Bug Loop

**Any FAIL result becomes a bug that loops back through `/tdd`:**

1. For each bug, write a failing test that reproduces it (RED)
2. Fix it (GREEN)
3. Commit
4. Re-run the manual test for that story to verify

**Do NOT proceed to `/retro` with known bugs.** The manual test gate must be clean.

```
/finish → /manual-test → bugs found? → /tdd (fix each bug) → /manual-test (re-verify) → /retro
```

The loop continues until all stories pass manual testing.

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
- [ ] Results recorded in .docs/manual-test-results.md
- [ ] All bugs fixed via TDD loop
- [ ] Re-verification passed after bug fixes
- [ ] Application shut down cleanly
