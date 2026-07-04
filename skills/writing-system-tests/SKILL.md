---
name: writing-system-tests
description: "Use BEFORE implementing any feature that has stories in .docs/stories/ — generates failing acceptance specs from acceptance criteria as the RED phase of TDD. Generates HTTP/request-level acceptance tests for headless/API projects, end-to-end UI tests for projects with a frontend, using the project's own test framework and directory conventions."
enforcement: gating
phase: build
---

# Writing Acceptance Tests

## Overview

Generate failing acceptance specs from user stories in `.docs/stories/*.md`. Each acceptance
criterion (happy AND negative paths) becomes a concrete test. Tests are generated BEFORE
implementation — they are the RED phase of BDD.

This skill is **language- and framework-agnostic.** It describes *what* acceptance tests to
write and *why*; the concrete syntax, test runner, file layout, and fixture mechanism come
from the project's own conventions. Detect those from the loaded tech-context (see
`tech-context/`) or from the existing test suite, and follow them — exactly as the `/tdd` skill
defers to "stack test conventions."

**Detect project shape and generate the right kind of acceptance test:**

| Project Shape | Acceptance Test Type | Exercises |
|---|---|---|
| Headless / API (no UI) | HTTP / request-level acceptance tests | HTTP requests, status codes, serialized (JSON/XML/etc.) responses |
| Has a frontend / full-stack | End-to-end (E2E) / UI tests | A real UI driver — browser, native, or TUI — navigation and user-visible assertions |

**The test framework and paths are the project's, not this skill's.** Place and name specs per
the project's conventions. Illustrative mappings (adapt to whatever the project actually uses):

| Stack | HTTP-level acceptance | E2E / UI |
|---|---|---|
| Ruby + RSpec | `spec/integration/` (`type: :request`) | `spec/system/` (Capybara) |
| Python + pytest | `tests/integration/` (httpx/requests) | `tests/e2e/` (Playwright/Selenium) |
| JS/TS + Jest/Vitest | `test/integration/` (supertest) | `test/e2e/` (Playwright/Cypress) |
| Go | `*_integration_test.go` (`net/http/httptest`) | `e2e/` (chromedp/rod) |

## When to Use

Run this **after `/plan` and before `/pipeline`** (or `/tdd`). The flow is:

```
/stories → /conflict-check → /plan → /writing-system-tests → /pipeline
```

**Trigger when:**
- About to implement a feature and stories exist without corresponding acceptance specs
- New story files added to `.docs/stories/`
- User asks for acceptance tests, integration tests, BDD tests, E2E tests, or system tests

**Skip when:**
- Acceptance specs already exist for the stories
- Writing unit/model specs (that's the TDD skill's job)

## Process

### 1. Detect Project Type

First, determine the **test framework, runner, and directory layout** from the loaded
tech-context or, if none, by inspecting the existing test suite (test directories, config files
like `package.json`/`pyproject.toml`/`Gemfile`/`go.mod`, and how current tests are written).
Match those conventions — do not impose a foreign layout.

Then determine **project shape** to pick the acceptance test type:

- A frontend exists (server-rendered templates, an SPA, a mobile/desktop UI, or a TUI) →
  **Full-stack** → end-to-end / UI tests driven through a real UI driver.
- No UI; a service, API, library, or CLI only → **Headless** → HTTP/request-level acceptance
  tests (or, for a library/CLI, public-interface / command-invocation acceptance tests).

### 2. Check for Missing Acceptance Specs

Compare `.docs/stories/*.md` against the existing acceptance specs in the project's acceptance
test directory (whatever the framework uses — see §1). Generate specs for any story file that
lacks a corresponding spec.

**Skip specs for already-tested behavior:** Before generating, grep the existing test suite
for overlap. For each acceptance criterion, search test files for keywords from the criterion
(e.g., function/method names, status codes, error messages). If a matching test already exists —
unit test, request/endpoint test, or prior acceptance spec — do not generate a duplicate.

Concrete check: `grep -rE "criterion keyword" <the project's test directories>`. If a test file
already asserts the expected behavior, skip that criterion. Log skipped criteria so the retro
can verify nothing was missed.

**End-to-end, not mocked:** Acceptance specs test the real system. Do NOT mock internal
infrastructure (database, queues, caches, background jobs). Only mock **third-party external
services** (payment APIs, email providers, external webhooks) that are outside the project's
control. If a spec requires infrastructure that isn't available in the test environment,
configure the test environment to provide it — don't mock it away.

### 3. Parse Acceptance Criteria

Extract from each story file:
- Feature area name (H1 or filename)
- Story titles (H2)
- Happy path criteria (Given/When/Then under Happy Path heading)
- Negative path criteria (Given/When/Then under Negative Paths heading)

**Both happy AND negative paths become tests.** Negative paths are not optional.

**Derive specs from stories, not code.** Extract field names, value types, and expected
behaviors from the story acceptance criteria TEXT — not from existing implementation code.
If the story says `refresh_token`, the spec must use `refresh_token` even if the current
code uses `token`. The spec defines what SHOULD exist, not what DOES exist.

### 3.5. Domain Alignment Check

Before generating specs, compare field names and context keys used in generated specs against
the story language. Flag any spec that uses implementation-derived names instead of
story-specified names. This catches cases where code conventions diverge from domain language
(e.g., builder context key `token` vs story's `refresh_token`, model field `payload` vs
story's `request_payload`).

### 3a. Classify Story Flows

Before generating specs, classify each story:

- **Multi-step flow** (2+ endpoints/operations in the happy path): Generate an
  integration/acceptance spec. Examples: "create a contact then assign tags", "search contacts
  filtered by tag".
- **Single-operation** (1 endpoint/operation CRUD): Mark as `unit-covered` — this story will be
  covered by the lower-layer tests written during implementation (the framework's
  request/endpoint or unit tests under `/tdd`). Do NOT generate an acceptance spec for it.
  Examples: "create a contact", "delete a tag", "update a contact's email".

**If ALL stories are single-operation (pure CRUD with no multi-step business logic), skip
acceptance spec generation entirely.** The lower-layer tests from TDD will cover all acceptance
criteria. Only generate acceptance specs when at least one story genuinely crosses 2+
endpoints/operations.

This avoids generating acceptance specs that duplicate lower-layer tests for simple CRUD operations.

### 3b. Replacement Tasks: Drive the REAL Entry Point

When a task **replaces or supersedes existing behavior** (the plan says "replace X",
"supersede Y", "swap the old path for the new"), the new code is only correct if the
PRODUCTION entry point actually calls it. A unit test that invokes the new function
*directly* passes even while the live path still calls the old one — the new primitive
ships orphaned (zero production callers). This class escaped into ~5 consecutive Phase-9
features; it is caught late by the fresh-context evaluator, not the suite.

**Rule:** for any replacement task, generate **≥1 acceptance test that drives the real
production entry point** (the command / handler / route / loop a user or caller actually
invokes) — NOT the new unit under test — and asserts the **observable artifact** the replacement
is supposed to produce (file written, PR opened, gate enforced, record persisted). The test
must fail if the entry point is still wired to the OLD behavior.

- Identify the real entry point from the story/plan ("when `runEngineerMode` processes an
  idea…"), not the new symbol ("when `runAuthoring` is called…").
- Assert the side effect, not the return value of the new unit.
- Pair with the `/pipeline` batch gate that greps the superseded symbol for zero non-test
  callers: the acceptance test proves the new path runs; the grep proves the old one is gone.

### 3c. Boundary-Value Checklist for Path / Prefix Guards

Any spec covering a **path, prefix, or canonical-root guard** (an allow/deny check on a
filesystem path or string prefix) MUST include explicit boundary-value cases. Off-by-one
normalization bugs in these guards fail *closed* (reject everything) or *open* (accept a
sibling) and are invisible to happy-path tests — this exact gap shipped a fail-closed
trailing-slash bug caught only by the evaluator.

Generate a negative/boundary case for EACH row:

| Boundary | Example input | Expected |
|---|---|---|
| Trailing slash | `<root>/repo/` vs canonical `<root>/repo` | normalized equal — write allowed |
| Root path | filesystem root | guarded, never a wildcard |
| Empty string | `""` | rejected, no crash |
| Sibling-prefix | `<root>/repo-evil` vs allowed `<root>/repo` | rejected (prefix ≠ path segment) |

A path-guard spec without these rows is incomplete — treat them as mandatory negative paths.

### 3d. Adversarial Derivation Coverage: Every Call Site, Real Input

§3b (replacement → real entry point) and §3c (path guards → boundary values) are two cases of a
wider rule. For **any security- or correctness-critical derivation** — a redaction/sanitizer, an
auth/permission predicate, an identity or path check, a state guard ("is the tree clean", "is this
the right session", "has this been processed") — a unit test that exercises the derivation on
**clean or hand-injected** input passes while the REAL production call site feeds it adversarial
real-world input that is never tested. The bug lives in the *wiring between the call site and the
derivation*, which the derivation's own unit test cannot reach. This class shipped CRITICAL/HIGH
bugs in three consecutive phases — a token-in-URL redaction invoked at a sibling call site with a
real token; a rebase predicate evaluated against a real in-progress tree instead of the clean
injected one; an injected project name that masked the real derivation — each caught only by the
fresh-context evaluator, never by the suite.

**Rule:** for each such derivation, enumerate **EVERY production call site** that invokes it, and
generate a failing spec **per call site** that:

- feeds the **real adversarial input that site actually passes** — a URL carrying a real token, a
  path with a trailing slash / sibling prefix / traversal segment, a dirty or stale tree state, an
  empty or boundary value — **not** a clean fixture or a value injected directly into the helper, and
- asserts the **observable guarantee at that site** — the token never appears in the emitted output,
  the write is refused, the step HALTs, the duplicate is skipped — **not** the derivation's return
  value in isolation.

A derivation covered only by its own unit test is incomplete. List the call sites you found
(`file:line`) in the spec file or the PR body so the domain reviewer (TDD) can confirm none were
missed.

### 3e. FR Coverage Mapping (Product Track)

**Scope:** this section runs only when both are true — the work is on the **product track**
and an **approved PRD** exists for the feature. If either condition is false (technical track,
or no approved PRD), skip this section entirely.

Parse the PRD's enumerated functional requirements (the `FR-N` list). Build a coverage table
with **exactly one row per FR** — every `FR-N` in the PRD must appear exactly once, and no row
may reference an `FR-N` that isn't in the PRD. A table that omits an FR or invents one not
present in the PRD is invalid and must be corrected before proceeding.

For each FR row, assign exactly one disposition from the **closed set**:

- **`already-tested`** — maps to the §2 overlap check. The FR's behavior is already asserted by
  an existing test (unit, request/endpoint, or prior acceptance spec) found via the §2 grep-for-overlap
  step.
- **`unit-covered`** — maps to the §3a classification. The FR corresponds to a single-operation
  (pure CRUD) story classified `unit-covered` under §3a, so it will be covered by the lower-layer
  tests written during `/tdd`, not by an acceptance spec here.
- **`spec-covered`** — the FR is covered by an acceptance spec generated in this pass (§5a/§5b).

No disposition outside this closed set (`already-tested`, `unit-covered`, `spec-covered`) is
permitted.

**Citation requirement:** every row must cite the evidence for its disposition:
- `already-tested` → cite the existing test file/line found by the §2 grep.
- `unit-covered` → cite the story and the §3a classification reasoning.
- `spec-covered` → cite the generated spec file (and test name) that covers it.

**Unresolved rows are flagged as errors.** A row is unresolved — and must be flagged rather than
silently accepted — if any of the following hold:
- it has 2 or more dispositions assigned (ambiguous),
- its disposition isn't one of the three closed-set values,
- it has no citation.

Unresolved rows block completion of this step; resolve them (re-classify, find the missing
citation, or split the ambiguous row) before moving to §4.

### 4. Read App Context

For each story, read the project's equivalents of:
- **Routing / endpoint definitions** — the route table, URL config, or handler registration that
  lists available paths and their names.
- **Request handlers / controllers** — response formats, auth requirements, middleware/filters.
- **Data models / schema** — validations, relations, enums (for fixture/factory setup).
- **Existing fixtures, factories, or test-data builders** — reuse them, don't duplicate.

If routes/models don't exist yet (pre-implementation), write tests using the expected paths and
names from the stories. Tests will fail with routing/handler-not-found, undefined-symbol, or
missing-table errors — this is correct RED behavior.

### 5a. Generate HTTP / Request-Level Acceptance Specs (Headless / API Projects)

**File mapping:** `.docs/stories/links.md` → the project's acceptance spec for that area
(e.g. `spec/integration/links_spec.rb`, `tests/integration/test_links.py`,
`test/integration/links.test.ts`).

Acceptance test of a multi-step flow, expressed as framework-neutral structure (write it in the
project's actual framework and assertion style):

```
SUITE "Link lifecycle":
  STORY "Create and use a short link":
    HAPPY PATH "creates a link, redirects via short code, records a click":
      POST /links  { original_url: "https://example.com" }   (with auth)
      short_code ← response.body.link.short_code
      GET /<short_code>
      EXPECT redirect → "https://example.com"
    NEGATIVE "expired link":
      # create link, advance clock past expiry
      GET /<short_code>  →  EXPECT 410 Gone
```

**Key distinction: acceptance specs test FLOWS, not endpoints/operations.**

An acceptance spec that only hits one endpoint is a request/endpoint test wearing a costume. If
the test doesn't cross at least 2 endpoints/operations or verify a multi-step story, it belongs
in the lower request/endpoint layer instead.

| Test hits one endpoint/operation | → request/endpoint-level test (the framework's request test layer) |
| Test hits 2+ endpoints/operations in sequence | → acceptance/integration test (this skill) |
| Test verifies model/domain logic directly | → unit test |

**This avoids duplication.** Request/endpoint tests own individual endpoint behavior (status
codes, error formats, params validation). Acceptance specs own the story flow (create → use →
verify outcome). Neither duplicates the other.

**Rules for acceptance specs:**
- Test multi-step flows that map to stories, not individual endpoints
- One group per story, one sub-group per happy/negative path (per the framework's grouping idiom)
- Each test is independent — creates its own data via factories/fixtures
- Assert outcomes, not intermediate transport details (request/endpoint tests own those)
- Auth uses helper methods, not hardcoded tokens
- No mocking external services in acceptance specs — test the real flow

**Helpers:** Create shared request helpers (e.g. response-body parsing and auth-header
construction) in the project's test-support location if they don't already exist.

### 5b. Generate End-to-End / UI Specs (Full-Stack Projects)

**File mapping:** `.docs/stories/auth.md` → the project's E2E spec for that area
(e.g. `spec/system/auth_spec.rb`, `tests/e2e/test_auth.py`, `test/e2e/auth.spec.ts`).

E2E test of a user flow, expressed as framework-neutral structure (write it with the project's
actual UI driver and assertion style):

```
SUITE "Authentication" (driven through a real UI driver):
  STORY "User Registration":
    HAPPY PATH "registers with valid email and password":
      visit  <new registration screen>
      fill   "Email" = "user@example.com",  set a valid password
      submit the form
      EXPECT visible text "Welcome"
    NEGATIVE "duplicate email":
      seed an existing user with "taken@example.com"
      visit  <new registration screen>
      fill   "Email" = "taken@example.com",  submit
      EXPECT visible text "already taken"
```

**Rules for E2E / UI specs:**
- Every criterion gets concrete driver code — no stubs, no `pending`/skipped placeholders
- Each test is independent — creates its own data, signs in if needed
- No mocking — full stack exercise
- Sign-in uses the actual login UI, not a session backdoor
- Assert on user-visible content and navigated location, not internal DOM/implementation details

### 6. Run and Verify RED

Run the acceptance suite using the project's test runner against its acceptance directory.
Examples (use whatever the project actually uses):

```bash
# Ruby + RSpec
bundle exec rspec spec/integration/        # or spec/system/
# Python + pytest
pytest tests/integration/                  # or tests/e2e/
# JS/TS
npm test -- test/integration               # or test/e2e
# Go
go test ./... -run Integration
```

Confirm tests fail for the **right reasons**. This is critical:

**Acceptable pre-implementation failures** (the thing under test doesn't exist yet):
- Routing/handler-not-found, undefined symbol/name, missing table/migration
- `404 Not Found` — endpoint not implemented

**Unacceptable failures (fix the spec):**
- Test passes when it shouldn't, or fails with a wrong error (e.g., a validation error like
  "can't be blank" when the spec expects "not found")
- Syntax errors or typos in the spec

**A test that fails for the wrong reason is not RED — it's broken.**

**A skipped, deselected, or collection-errored spec is not RED either.** If the runner reports your
new specs as SKIPPED (e.g. a `pytest.importorskip` / `skipif` for a missing testcontainer, service,
or dependency), DESELECTED, or ERRORING at import/collection, they never executed — a silent no-op,
not a failing test. Two rules follow:

- **Run the command that actually includes the new specs.** Never scope the RED run to a unit-only
  subset (e.g. `pytest tests/` when the specs live under `spec/integration/`, or `npm test -- test/unit`).
  Run against the directory the specs were written to.
- **Bring up the infrastructure the specs need** (containers, DB, Redis, services, env) so they
  execute and FAIL for the right reason. A spec that only runs in CI but is skipped locally/in the
  daemon is a gate hole: the build will be declared GREEN while the specs never ran, and CI (which
  has the infra) then fails.

**Record the RED evidence (gating).** After the RED run, write `.pipeline/acceptance-specs-red.json`
capturing the REAL result of running the feature's own specs, so the harness can verify they
actually executed — not merely that spec files exist on disk:

```json
{
  "command": "cd backend && pytest spec/integration/test_017_sec_edgar_acceptance.py",
  "targetSpecs": ["spec/integration/test_017_sec_edgar_acceptance.py"],
  "executed": 5,
  "passed": 0,
  "failed": 5,
  "skipped": 0,
  "errors": 0,
  "summary": "5 failed in 12.3s"
}
```

Counts are for the feature's own specs from the run above (`executed` = passed + failed). The
`acceptance_specs` gate REJECTS the step unless this file shows `failed >= 1`, `skipped == 0`,
`errors == 0`, and `executed >= 1`. A run where the new specs were skipped, deselected, or errored
at collection does not establish RED and will not pass the gate. This is gitignored run evidence,
not a committed design artifact.

### Stubbing Rules for Pre-Implementation Specs

- Stub at **system boundaries only**: randomness sources, the clock/current time, external API
  clients, environment variables/config.
- Never stub internal methods (private callbacks, service internals) — they don't exist yet and
  coupling to them breaks on implementation.
- Example of a correct boundary stub: freeze the clock, or pin the random generator to a known
  value, using the framework's idiomatic stub/mock facility.

### 7. Commit the Failing Tests

```bash
git add <acceptance test dir> <test support dir>   # paths per the project's layout
git commit -m "test: add failing acceptance specs for [feature area]"
```

Failing tests get committed. They represent the acceptance criteria.
Implementation (via `/pipeline` or `/tdd`) makes them pass.

## How This Relates to Other Test Types

```
Acceptance specs (this skill)      — Multi-step story flows across 2+ endpoints/operations
  ↕ generated from .docs/stories/     "Create link → visit → verify click recorded"
  ↕ NO single-operation tests here

Request/endpoint tests (TDD)       — Single endpoint/operation contract
  ↕ generated during RED phase        "POST /links with blank URL returns 422"
  ↕ owns: status codes, error formats, params validation, headers

Unit tests (TDD per-model/module)  — Domain/model logic in isolation
  ↕ generated during RED phase        "generate_short_code returns 6 chars"
  ↕ owns: validations, callbacks, business methods
```

**Each layer tests something the others don't.** If a test could live in a lower layer, it should.
Acceptance specs are expensive — only use them for multi-step flows that can't be verified at a
lower level. This skill handles the top layer. TDD handles the bottom two.
