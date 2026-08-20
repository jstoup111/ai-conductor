---
name: writing-system-tests
description: "Use BEFORE implementing any feature that has stories in .docs/stories/ — generates failing acceptance specs from acceptance criteria as the RED phase of TDD. Generates HTTP/request-level acceptance tests for headless/API projects, end-to-end UI tests for projects with a frontend, using the project's own test framework and directory conventions."
enforcement: gating
phase: build
requires: [verify-claims]
---

# Writing Acceptance Tests

## Overview

Generate failing acceptance specs from user stories in `.docs/stories/*.md`. Each acceptance
criterion (happy AND negative paths) receives a concrete coverage disposition. Only the criteria
that need acceptance/system coverage become generated specs; those specs are written BEFORE
implementation and are the RED phase of BDD.

**Correctness gate:** a test encodes an expected-behavior claim. Per the `/verify-claims` protocol,
if a spec rests on an assumption about what "correct" means that is not pinned by the story's
acceptance criteria, the FR, or the ADR, surface it with its confidence and HARD-BLOCK for operator
approval (HALT if autonomous) rather than freezing a guess into a passing/failing assertion.

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

For **every** happy and negative criterion in every story, record one concrete coverage
disposition before writing a spec. This applies on both the product and technical tracks:

- **`existing-sufficient-test`** — a named existing behavioral test already proves the criterion
  at a sufficient layer. Cite its path and test name/line.
- **`planned-lower-layer-test`** — a named behavioral test assigned to the implementation task
  will prove the criterion sufficiently below the acceptance layer. Cite the plan task and the
  intended request/endpoint, command/public-interface, or unit/domain test.
- **`acceptance-system-spec`** — this pass will write and execute an acceptance/system spec for a
  distinct multi-step externally observable flow that cannot be proven sufficiently below. Cite
  the target spec and flow.

The disposition is about the behavior and its failure boundary, not the directory label of a test.
A request-level test can be sufficient for a public command or endpoint contract; a test under an
`integration` directory is not automatically acceptance coverage. Negative permutations remain at
the lower layer when that layer proves the observable failure sufficiently. Do not elevate each
negative permutation merely to populate an acceptance suite.

Every criterion must have exactly one disposition and its cited proof or assigned test. If a
criterion has neither existing proof nor a specific planned/generated test, block this step and
report the criterion; do not silently omit it or create a speculative spec. Ordinary changes to
skill prose and the existence, creation, or modification of a production file do not themselves
create behavioral criteria or require a test.

Record the criterion dispositions and citations in this step's report. On the product track, the
FR table in §3e additionally maps the same record to approved functional requirements; it does not
replace the all-track criterion check.

Only after this disposition pass, compare the `acceptance-system-spec` criteria against the
project's existing acceptance specs in its established layout. Generate only the uncovered flows.

### 2a. Declared Pattern Replication

When the active plan's header resolves a complete `**Pattern-source:**` and
`**Rename-map:**` declaration, `acceptance_specs` **copies rather than derives** the source
feature's acceptance specs. This replacement applies only to a resolved declaration; with no
declaration, derive specs from the stories exactly as this skill otherwise requires.

Copy each source spec to its rename-map-derived target path, applying the map to its filename and
content.

Locate the source feature's acceptance specs using the project's established acceptance-spec
layout. For each source spec, apply the ordered Rename-map to both its relative path (including
the filename) and its content, then write the resulting target spec. Run those copied specs at
`acceptance_specs` time before continuing.

Before writing, enumerate the source acceptance-spec glob and all derived target paths. If the
source acceptance spec set is empty, fail closed: report the declared Pattern-source and the
acceptance-spec glob that found no specs, and never fall back to derivation. If two source specs
derive the same target-path collision, fail closed before any write rather than overwriting either
target. These are declaration-copy failures, not reasons to resume the ordinary derivation path.

The copied run earns RED only when its failure includes at least one copied spec failing because
the target does not yet exist, with a non-zero failure count and zero errors and zero skips. Record
that real result using the existing §6 RED-evidence contract. Never fall back to derivation after a
declaration has resolved: copied specs are the feature's acceptance coverage for this step.

If all copied specs pass, fail closed and report the passing specs by path. A fully passing copied
set establishes neither the required missing-target RED failure nor evidence that the copied tests
exercise the new target; do not treat it as successful RED evidence.

**Find existing sufficient proof:** Before generating, search the existing test suite for each
criterion's behavior and failure boundary (for example, function/method names, status codes, and
error messages). A keyword hit alone is not proof: confirm the test asserts the expected behavior.
If it does — unit, request/endpoint, command/public-interface, or prior acceptance spec — assign
`existing-sufficient-test` and do not generate a duplicate.

Concrete search: `grep -rE "criterion keyword" <the project's test directories>`. Record the
criterion's disposition and citation; this record, rather than a count of generated specs, proves
nothing was missed.

### No Legitimate Acceptance-Spec RED for Already-Existing Behavior

For a plan-marked verify-only/verification task, generate at most the documenting acceptance spec
explicitly requested by the plan. Outside such a task, no acceptance spec is invented for
already-existing behavior just to manufacture a RED result.

If investigation discovers that behavior already exists but the sealed plan did not mark the task
verify-only/verification, follow `/tdd`'s **No Legitimate RED for Already-Existing Behavior**
discovered-case exit. Do not amend the sealed plan or retain a redundant acceptance spec. This
boundary never applies to work that adds, changes, or fixes behavior.

**End-to-end internally; fake third parties:** Acceptance specs test the real application entry
point and internal system. Do NOT mock internal infrastructure (database, queues, caches,
background jobs). Replace every **third-party external service** (LLM providers, hosted APIs,
GitHub, payment APIs, email providers, external webhooks, package registries) with a faithful fake
through the production adapter seam. If locally controlled infrastructure is unavailable in the
test environment, configure the test environment to provide it — don't mock it away. Calls to a
real third party belong only in an explicitly named, opt-in smoke test that is excluded from the
default suite and CI.

### 2.5. Schema Consistency Check

Before generating specs, compare model/entity column definitions against migration files:
- Check that column names in models match column names in migrations (e.g., `external_id` in
  model vs `external_reference_id` in migration is a mismatch)
- Check that column types match (e.g., `payload` string vs `request_payload`/`response_payload`
  split columns)
- If the project uses fake/stub column definitions (e.g., `fake_columns.rb`), verify those
  match the real migration definitions

**Do not generate specs from inconsistent schemas — resolve the mismatch first.** Specs
generated against a mismatched schema will either pass incorrectly or fail for the wrong reason.

### 3. Parse Acceptance Criteria

Extract from each story file:
- Feature area name (H1 or filename)
- Story titles (H2)
- Happy path criteria (Given/When/Then under Happy Path heading)
- Negative path criteria (Given/When/Then under Negative Paths heading)

**Both happy AND negative paths need a coverage disposition.** Negative paths are not optional;
when a lower-layer behavioral test is sufficient, assign it there rather than duplicating it above.

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

### 3a. Classify Behavioral Scope

For each criterion, decide the lowest layer that can prove its behavior. Generate an
acceptance/system spec only when the criterion belongs to a **distinct multi-step externally
observable flow** that a lower-layer behavioral test cannot prove sufficiently. Typical examples
are create → assign → observe an outcome, or configure → invoke → observe an externally visible
result. The operations need not be HTTP endpoints; use the project's actual public interface.

Single operations and their validation/error permutations normally receive
`planned-lower-layer-test` coverage through `/tdd` — for example, a request/endpoint, command, or
domain test. A multi-step sequence does not automatically need an acceptance spec if a lower-layer
behavioral test can already prove the relevant observable flow. Conversely, a multi-step external
flow that cannot be proven below receives `acceptance-system-spec` even if the project's directory
name would normally suggest another label.

If no criterion needs `acceptance-system-spec`, generate no acceptance specs. The disposition
record must still show sufficient existing proof or a specific lower-layer assignment for every
happy and negative criterion. This avoids duplicate acceptance coverage without treating any
criterion as optional. Record `outcome: "disposition-only"` in
`.pipeline/acceptance-specs-red.json` with an exhaustive `dispositions` array: each record names
one happy or negative criterion and is exactly either `existing-sufficient-test` with a verifiable
test `citation`, or `planned-lower-layer-test` with a verifiable plan `citation`, `owningTask`, and
`layer`. Do not fabricate an acceptance RED run in this case: the assigned lower-layer test must
produce its genuine RED evidence during `/tdd`, and no acceptance run contract or failing-spec
commit is written. Whenever this step copies or generates an acceptance/system spec, record
`outcome: "specs-generated"`; §6's executable RED machinery remains mandatory.

### 3b. Replacement Tasks: Drive the REAL Entry Point

When a task **replaces or supersedes existing behavior** (the plan says "replace X",
"supersede Y", "swap the old path for the new"), the new code is only correct if the
PRODUCTION entry point actually calls it. A unit test that invokes the new function
*directly* passes even while the live path still calls the old one — the new primitive
ships orphaned (zero production callers). This class escaped into ~5 consecutive Phase-9
features; it is caught late by the fresh-context evaluator, not the suite.

**Rule:** for any replacement task, assign **≥1 behavioral test at the lowest sufficient layer**
that drives the real production entry point (the command / handler / route / loop a user or caller
actually invokes) — NOT the new unit under test — and asserts the **observable artifact** the
replacement is supposed to produce (file written, PR opened, gate enforced, record persisted).
Use `acceptance-system-spec` only when this is a distinct multi-step externally observable flow
that cannot be proven below; otherwise assign a specific lower-layer behavioral test. The test
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
assign a failing behavioral test **per call site** at the lowest sufficient layer that:

- feeds the **real adversarial input that site actually passes** — a URL carrying a real token, a
  path with a trailing slash / sibling prefix / traversal segment, a dirty or stale tree state, an
  empty or boundary value — **not** a clean fixture or a value injected directly into the helper, and
- asserts the **observable guarantee at that site** — the token never appears in the emitted output,
  the write is refused, the step HALTs, the duplicate is skipped — **not** the derivation's return
  value in isolation.

A derivation covered only by its own unit test is incomplete. List the call sites you found
(`file:line`) in the assigned test file or the PR body so the domain reviewer (TDD) can confirm none were
missed.

### 3e. FR Coverage Mapping (Product Track)

**Scope:** this section runs only when both are true — the work is on the **product track**
and an **approved PRD** exists for the feature. If either condition is false (technical track,
or no approved PRD), skip this section entirely.

- **If technical track:** perform no FR-coverage work, emit no table, complete exactly as today
  (§1–§7 unchanged). No error; the gate is skipped for non-product features.
- **If no PRD in `.docs/specs/`:** perform no FR-coverage work, emit no table, complete as-is.
  No error; the gate does not apply.
- **If a PRD exists but `Status: Approved` is not in the file:** do NOT build a table from an
  unapproved FR list — report the task as **FAILED** with the reason "PRD found but not
  approved; cannot gate on incomplete FR list." This surfaces the missing approval as a
  pipeline error rather than a silent no-op.

Parse the PRD's enumerated functional requirements (the `FR-N` list). Build a coverage table
with **exactly one row per FR** — every `FR-N` in the PRD must appear exactly once, and no row
may reference an `FR-N` that isn't in the PRD. A table that omits an FR or invents one not
present in the PRD is invalid and must be corrected before proceeding.

For each FR row, derive exactly one disposition from the criterion record's **closed set**:

- **`existing-sufficient-test`** — maps to §2. The FR's behavior is asserted by a cited existing
  behavioral test at a sufficient layer.
- **`planned-lower-layer-test`** — maps to §3a. The cited implementation task owns the specific
  lower-layer behavioral test that will prove the FR.
- **`acceptance-system-spec`** — the FR is covered by a generated (or declared-copy) acceptance/
  system spec in this pass (§5a/§5b).

No disposition outside this closed set (`existing-sufficient-test`,
`planned-lower-layer-test`, `acceptance-system-spec`) is permitted.

**Citation requirement:** every row must cite the evidence for its disposition:
- `existing-sufficient-test` → cite the existing test file/line found by the §2 search.
- `planned-lower-layer-test` → cite the implementation plan task and intended test.
- `acceptance-system-spec` → cite the generated spec file (and test name) that covers it.

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

An acceptance spec that only hits one endpoint is usually a request/endpoint test wearing a
costume. If it does not prove a distinct multi-step externally observable flow that cannot be
proven sufficiently below, it belongs in the lower behavioral layer instead.

| Test proves one operation or negative permutation sufficiently | → lower-layer behavioral test |
| Test proves a distinct multi-step external flow no lower layer can prove | → acceptance/system spec (this skill) |
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
- Exercise the real internal flow; inject faithful fakes at all third-party adapter boundaries
- On product track: every generated spec identifies the FR(s) it covers — either in the
  top-level suite/describe name OR as a leading comment line `Covers: FR-N[, FR-M]`
  (framework-agnostic; comma-separated for multiple FRs) — so `grep -rE "FR-[0-9]+"` over the
  acceptance directory finds every FR's specs.

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
- Every criterion assigned `acceptance-system-spec` gets concrete driver code — no stubs, no
  `pending`/skipped placeholders
- Each test is independent — creates its own data, signs in if needed
- Do not mock the application stack or locally controlled infrastructure; inject faithful fakes
  at every third-party adapter boundary
- Sign-in uses the actual login UI, not a session backdoor
- Assert on user-visible content and navigated location, not internal DOM/implementation details
- On product track: every generated spec identifies the FR(s) it covers — either in the
  top-level suite/describe name OR as a leading comment line `Covers: FR-N[, FR-M]`
  (framework-agnostic; comma-separated for multiple FRs) — so `grep -rE "FR-[0-9]+"` over the
  acceptance directory finds every FR's specs.

### 6. Run and Verify RED (Generated or Copied Acceptance/System Specs)

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

**Record the RED evidence (gating, `specs-generated` only).** After the RED run, write `.pipeline/acceptance-specs-red.json`
capturing the REAL result of running the feature's own specs, so the harness can verify they
actually executed — not merely that spec files exist on disk:

```json
{
  "outcome": "specs-generated",
  "command": "cd backend && pytest spec/integration/test_017_sec_edgar_acceptance.py",
  "targetSpecs": ["spec/integration/test_017_sec_edgar_acceptance.py"],
  "executed": 5,
  "passed": 0,
  "failed": 5,
  "skipped": 0,
  "errors": 0,
  "failingTests": [
    {
      "name": "returns the archived filing",
      "reason": "the archive endpoint is not implemented"
    }
  ],
  "ranAt": "2026-08-10T12:00:00.000Z",
  "intentRationale": "The failing endpoint proves the requested archive behavior is not implemented.",
  "summary": "5 failed in 12.3s"
}
```

Counts are for the feature's own specs from the run above (`executed` = passed + failed). The
`acceptance_specs` gate REJECTS the step unless this file shows `failed >= 1`, `skipped == 0`,
`errors == 0`, and `executed >= 1`. A run where the new specs were skipped, deselected, or errored
at collection does not establish RED and will not pass the gate. The marker must also identify at
least one failing test with its failure reason, record when the run occurred (`ranAt`), and state
why the observed failure proves the feature remains unimplemented (`intentRationale`). This is
gitignored run evidence, not a committed design artifact.

#### Record the FR coverage evidence (gating)

**Scope:** this subsection runs only for product-track work with an approved PRD (the same
condition as §3e). If the work is technical-track or no approved PRD exists, skip this
subsection entirely — no evidence file is written, no error.

**Finalize the §3e table.** Before writing the evidence file, verify every row is actually
correct, not just internally consistent:
- For each `existing-sufficient-test` or `acceptance-system-spec` row, confirm the cited spec/test
  file **exists on disk** and, for `acceptance-system-spec` rows, **contains the FR identifier** — run
  `grep -E "FR-N"` (substituting the real FR number) against the cited file and confirm a match.
- For each `planned-lower-layer-test` row, confirm the cited implementation task and intended test
  are present in the plan.
- Re-check that every `FR-N` in the PRD has exactly one row, no invented rows exist, and every
  disposition is one of the closed set (`existing-sufficient-test`,
  `planned-lower-layer-test`, `acceptance-system-spec`).

**Write `.pipeline/fr-coverage.md`** with this format:

```markdown
# FR Coverage — <feature-stem>

PRD: .docs/specs/<feature-stem>.md
Date: <YYYY-MM-DD>

| FR   | Disposition    | Evidence                                              |
|------|----------------|--------------------------------------------------------|
| FR-1 | acceptance-system-spec  | spec/integration/links_spec.rb — "expired link" |
| FR-2 | planned-lower-layer-test | plan Task 4 — request test for invalid link input |
| FR-3 | existing-sufficient-test | spec/requests/links_spec.rb:42                   |

Coverage: COMPLETE
```

The verdict line is the last line of the file:
- **`Coverage: COMPLETE`** — every FR in the PRD has exactly one row, a valid disposition, a
  citation, and the citation was verified to exist (and, where applicable, to contain the FR
  identifier or match the story file).
- **`Coverage: INCOMPLETE — unresolved: FR-N, FR-M...`** — list every FR that failed
  verification, in ascending order, comma-separated.

**GATE.** If any FR is unresolved (missing row, invented row, bad or duplicate disposition,
missing or unverifiable citation) or `.pipeline/fr-coverage.md` cannot be written, the step MUST
NOT report success — output the failure reason listing every unresolved FR with its cause and
stop (a hard stop under the daemon, not a logged warning).

On complete resolution, report the task as PASS with the evidence file written and the verdict
"Coverage: COMPLETE".

For `disposition-only`, write only this outcome record instead; it must contain no RED counters,
run command, target specs, exception, or other generated-spec fields:

```json
{
  "outcome": "disposition-only",
  "dispositions": [
    {
      "criterion": "happy: reports the persisted result",
      "disposition": "existing-sufficient-test",
      "citation": "test/engine/result.test.ts:42"
    },
    {
      "criterion": "negative: rejects a missing result",
      "disposition": "planned-lower-layer-test",
      "citation": ".docs/plans/<feature-stem>.md:88",
      "owningTask": "Task 5",
      "layer": "engine"
    }
  ]
}
```

#### Record the run contract (deterministic RED backstop, `specs-generated` only)

**Write `.pipeline/acceptance-specs-run.json` before reporting complete.** The RED evidence in
`.pipeline/acceptance-specs-red.json` captures the RESULT of one run this skill happened to
perform. If that run never happened, or the daemon needs to re-establish RED later (e.g. after
a self-heal), the engine has no deterministic way to know *how* to re-run this feature's specs
on its own. The run contract fixes that: it is the exact, machine-replayable command the
engine's self-heal runner uses to redrive RED without guessing a path or invoking an LLM.

Shape — exactly three fields, matching the command actually run in this step:

```json
{
  "command": "cd backend && pytest spec/integration/test_017_sec_edgar_acceptance.py",
  "cwd": "backend",
  "targetSpecs": ["spec/integration/test_017_sec_edgar_acceptance.py"]
}
```

- `command` — the full shell command used to run this feature's own specs (same command as the
  RED run above).
- `cwd` — the working directory the command must be run from, relative to the repo root
  (`"."` if the command is run from the repo root itself).
- `targetSpecs` — the spec file(s)/path(s) the command targets, matching `targetSpecs` in
  `acceptance-specs-red.json`.

The command's output must finish with exactly one machine-readable evidence line so the engine can
replay it without guessing framework-specific text:

```text
ACCEPTANCE_RED_EVIDENCE: {"executed":5,"passed":0,"failed":5,"skipped":0,"errors":0,"failingTests":[{"name":"returns the archived filing","reason":"the archive endpoint is not implemented"}],"intentRationale":"The failing endpoint proves the requested archive behavior is not implemented."}
```

This line is part of the command's own output contract. It carries the fresh observed counters and
provenance; the engine adds the recorded command, target specs, and fresh run timestamp before it
replaces an older marker. A command that does not emit valid evidence is refused without overwriting
the prior marker.

Write this file **after** the RED run succeeds and **before** this skill reports the step
complete — it is not optional evidence, it is the deterministic backstop the engine consumes
when the red-evidence marker is missing or misplaced. This is gitignored run evidence, not a
committed design artifact, same as `acceptance-specs-red.json`.

### Stubbing Rules for Pre-Implementation Specs

- Stub at **system boundaries only**: randomness sources, the clock/current time, external API
  clients, environment variables/config.
- Never stub internal methods (private callbacks, service internals) — they don't exist yet and
  coupling to them breaks on implementation.
- Example of a correct boundary stub: freeze the clock, or pin the random generator to a known
  value, using the framework's idiomatic stub/mock facility.

### 7. Commit the Failing Tests (`specs-generated` only)

```bash
git add <acceptance test dir> <test support dir>   # paths per the project's layout
git commit -m "test: add failing acceptance specs for [feature area]"
```

For `specs-generated`, failing tests get committed. They represent the acceptance criteria and
implementation (via `/pipeline` or `/tdd`) makes them pass. For `disposition-only`, do not commit
an acceptance spec; the cited lower-layer task owns its genuine RED test and commit.

**Verification checklist before completing this skill:**
- `.pipeline/acceptance-specs-red.json` records exactly one outcome:
  `specs-generated` with RED evidence, or `disposition-only` with exhaustive cited happy and
  negative criterion records
- For `specs-generated`, RED evidence and the run contract are written before reporting complete
- For `disposition-only`, no acceptance spec, RED-run evidence fields, run contract, or
  failing-spec commit is written
- Evidence file written to `.pipeline/fr-coverage.md` (only for product-track runs with an
  approved PRD) with verdict "Coverage: COMPLETE" — otherwise the step is a hard stop per §6's
  FR-coverage gate
- For `specs-generated`, failing tests committed

## How This Relates to Other Test Types

```
Acceptance specs (this skill)      — Distinct multi-step externally observable flows that
  ↕ generated from .docs/stories/     cannot be proven sufficiently below
  ↕                                    "Create link → visit → verify click recorded"

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

## Verify

- [ ] Every story's happy AND negative criterion has exactly one cited disposition:
      `existing-sufficient-test`, `planned-lower-layer-test`, or `acceptance-system-spec`
- [ ] Acceptance specs generated only for the assigned distinct multi-step externally observable
      flows that cannot be proven sufficiently below
- [ ] `.pipeline/acceptance-specs-red.json` declares `specs-generated` or `disposition-only`
- [ ] When `specs-generated`, an acceptance/system spec was EXECUTED, not just written —
      a spec that never ran does not establish RED
- [ ] When `specs-generated`, the real RED run's results are
      recorded to `.pipeline/acceptance-specs-red.json`
      (command, targetSpecs, executed/passed/failed/skipped/errors counts, failing-test identity,
      `ranAt`, and `intentRationale`) — the
      completion gate validates this file and rejects runs where the feature's own
      specs were skipped, deselected, or errored at collection
- [ ] When `specs-generated`, failures are for the RIGHT reason (missing implementation), not
      import/syntax/collection errors
- [ ] When `specs-generated`, specs use the project's own test framework and directory conventions
- [ ] When `specs-generated`, the run contract is written to `.pipeline/acceptance-specs-run.json` (command, cwd,
      targetSpecs) before reporting complete — the deterministic RED backstop the engine's
      self-heal runner consumes when the RED evidence marker is missing or misplaced
