# Implementation Plan: Browsable Documentation Site

**Date:** 2026-07-30
**Design:** [2026-07-30-browsable-documentation-site](../specs/2026-07-30-browsable-documentation-site.md)
**Stories:** [browsable-documentation-site](../stories/browsable-documentation-site.md)
**Architecture:** [adr-2026-07-30-pinned-remote-theme-for-pages-navigation](../decisions/adr-2026-07-30-pinned-remote-theme-for-pages-navigation.md)
**Conflict check:** Clean as of 2026-07-30

## Summary

Complete the existing default-branch GitHub Pages publication with a pinned Just the Docs site, a hosted landing page, hierarchical metadata for all 29 current topics, deterministic offline navigation validation, a repository front-door link, and an opt-in post-merge smoke probe. The plan contains 15 sequential TDD tasks; every default test fakes or avoids third-party boundaries.

## Technical Approach

- Keep GitHub Pages configured for `main:/docs`; add no deployment workflow.
- Configure `remote_theme: just-the-docs/just-the-docs@v0.12.0`, the repository Pages URL/base path, responsive navigation, and repository auxiliary links in `docs/_config.yml`.
- Make `docs/index.md` the public root. Add one index page per existing top-level taxonomy and YAML front matter (`title`, `parent`, `nav_order`) to every topic so Just the Docs generates one deterministic hierarchy.
- Implement the navigation contract as two Bash surfaces: a pure checker accepting an explicit repository root and a fixture-driven test. The checker verifies the theme pin, landing/section indexes, front-matter boundaries, unique sibling titles, valid parents, and full Markdown enumeration. It performs no network calls.
- Wire the fixture suite plus a real-tree pass into `test/test_harness_integrity.sh`. Keep existing Lychee internal-link validation unchanged.
- Add a separately named opt-in smoke script for GitHub Pages API/HTTP evidence. Its ordinary test injects fake `gh` and `curl` commands; the default suite never reaches GitHub.

## Prerequisites

- Existing GitHub Pages status remains `built`, public, HTTPS, and sourced from `main:/docs`.
- Approved ADR `adr-2026-07-30-pinned-remote-theme-for-pages-navigation` remains authoritative.
- Bash, `shellcheck`, and the repository's existing validation dependencies are available.

## Tasks

### Task 1: Validate the pinned site configuration contract

**Story:** Story 9, happy path 1 and negative path 1
**Story:** Story 6, negative path 1
**Type:** negative-path

**Steps:**
1. Write failing fixture tests proving a missing configuration, missing remote theme, moving theme reference, and wrong release pin each return non-zero with the fixture path and violated key.
2. Verify the fixture tests fail (RED).
3. Implement root-parameterized configuration parsing in `test/check_docs_navigation.sh`, requiring the exact approved v0.12.0 pin without contacting GitHub.
4. Verify every fixture passes (GREEN).
5. Commit with message: "test(docs): enforce pinned Pages theme contract"

**Files:**
- `test/check_docs_navigation.sh`
- `test/test_docs_navigation.sh`

**Wired-into:** `test/test_docs_navigation.sh#main`

**Dependencies:** none

### Task 2: Validate landing and section-index structure

**Story:** Story 1, happy path 2 and negative path 2
**Story:** Story 2, both happy and negative paths
**Type:** negative-path

**Steps:**
1. Add failing fixtures for a missing landing page, missing required taxonomy section, and a landing link that targets a non-hosted/missing section index.
2. Verify the new fixtures fail (RED).
3. Extend the checker to require the root landing page plus Quickstart, Guides, Reference, Explanation, Runbooks, and Contributing entries, resolving each local target under the fixture root.
4. Verify all landing fixtures pass (GREEN).
5. Commit with message: "test(docs): enforce hosted landing taxonomy"

**Files:**
- `test/check_docs_navigation.sh`
- `test/test_docs_navigation.sh`

**Wired-into:** same as Task 1

**Dependencies:** Task 1

### Task 3: Validate complete and unambiguous topic navigation

**Story:** Story 3, negative path 1
**Story:** Story 4, both happy and negative paths
**Story:** Story 9, negative path 1
**Type:** negative-path

**Steps:**
1. Add failing fixtures for missing front matter, missing/empty title, nested topic without a parent, unknown parent, duplicate sibling title, and an orphaned Markdown topic.
2. Verify each fixture fails with the offending relative path (RED).
3. Extend the checker to enumerate every published Markdown file, parse its leading front matter, build the title/parent hierarchy, reject ambiguity, and prove one navigation membership per topic.
4. Verify the valid fixture and every negative fixture pass their expected assertions (GREEN).
5. Commit with message: "test(docs): reject orphaned or ambiguous navigation"

**Files:**
- `test/check_docs_navigation.sh`
- `test/test_docs_navigation.sh`

**Wired-into:** same as Task 1

**Dependencies:** Task 2

### Task 4: Add the pinned site configuration and public landing page

**Story:** Story 1, both happy paths
**Story:** Story 2, happy path 1
**Story:** Story 3, both happy paths and negative path 2
**Story:** Story 5, happy path 2 and negative path 1
**Story:** Story 6, happy path 1
**Story:** Story 7, happy path 1 and negative path 1
**Type:** happy-path

**Steps:**
1. Add failing real-source assertions for the approved responsive theme pin, Pages URL/base path, site identity, enabled desktop/mobile navigation, and landing-page taxonomy links.
2. Verify the assertions fail against the current `docs/` source (RED).
3. Add `docs/_config.yml` and `docs/index.md` with the pinned theme, project identity, stable base URL, responsive navigation settings, and links to every required top-level section.
4. Verify the scoped real-source assertions pass (GREEN).
5. Commit with message: "feat(docs): add hosted site configuration and landing"

**Files:**
- `test/test_docs_navigation.sh`
- `docs/_config.yml`
- `docs/index.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 3

### Task 5: Add the top-level navigation section indexes

**Story:** Story 2, happy path 2 and negative path 2
**Story:** Story 3, happy paths 1 and 2
**Type:** happy-path

**Steps:**
1. Add failing assertions for the six hosted taxonomy destinations and their unique top-level titles/order.
2. Verify the assertions fail because section indexes are absent (RED).
3. Add concise index pages for Guides, Reference, Explanation, Runbooks, and Contributing, and confirm Quickstart remains a top-level destination.
4. Verify every section index and landing link passes (GREEN).
5. Commit with message: "feat(docs): add hosted documentation section indexes"

**Files:**
- `test/test_docs_navigation.sh`
- `docs/guides/index.md`
- `docs/reference/index.md`
- `docs/explanation/index.md`
- `docs/runbooks/index.md`
- `docs/contributing/index.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 4

### Task 6: Register every guide in hosted navigation

**Story:** Story 3, both happy and negative paths
**Story:** Story 4, happy path 1 and negative path 1
**Type:** happy-path

**Steps:**
1. Add a failing directory-specific assertion that every guide has a unique title, `Guides` parent, and stable order.
2. Verify the guide assertion fails (RED).
3. Add navigation front matter to each current guide without changing its prose or heading contract.
4. Verify all guide metadata and existing relative links pass (GREEN).
5. Commit with message: "feat(docs): register guides in site navigation"

**Files:**
- `test/test_docs_navigation.sh`
- `docs/guides/engineer-loop.md`
- `docs/guides/first-feature.md`
- `docs/guides/intake.md`
- `docs/guides/multiprovider.md`
- `docs/guides/running-the-daemon.md`
- `docs/guides/self-hosting.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 5

### Task 7: Register the first reference group in hosted navigation

**Story:** Story 3, both happy and negative paths
**Story:** Story 4, happy path 1 and negative path 1
**Type:** happy-path

**Steps:**
1. Add a failing assertion that Artifacts, CLI, Configuration, and Environment have unique titles under `Reference` with deterministic order.
2. Verify the reference-group assertion fails (RED).
3. Add the required front matter to the four topics without changing their prose.
4. Verify the scoped reference group passes (GREEN).
5. Commit with message: "feat(docs): register core reference topics"

**Files:**
- `test/test_docs_navigation.sh`
- `docs/reference/artifacts.md`
- `docs/reference/cli.md`
- `docs/reference/configuration.md`
- `docs/reference/environment.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 6

### Task 8: Register the remaining reference group in hosted navigation

**Story:** Story 3, both happy and negative paths
**Story:** Story 4, happy path 1 and negative path 1
**Type:** happy-path

**Steps:**
1. Add a failing assertion that Models, Settings and Hooks, Skills, and Steps have unique titles under `Reference` with deterministic order.
2. Verify the remaining-reference assertion fails (RED).
3. Add the required front matter to the four topics without changing their prose.
4. Verify the entire Reference section passes (GREEN).
5. Commit with message: "feat(docs): complete reference site navigation"

**Files:**
- `test/test_docs_navigation.sh`
- `docs/reference/models.md`
- `docs/reference/settings-and-hooks.md`
- `docs/reference/skills.md`
- `docs/reference/steps.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 7

### Task 9: Register every explanation topic in hosted navigation

**Story:** Story 3, both happy and negative paths
**Story:** Story 4, happy path 1 and negative path 1
**Type:** happy-path

**Steps:**
1. Add a failing assertion for unique `Explanation` children and deterministic order.
2. Verify the explanation assertion fails (RED).
3. Add navigation front matter to Architecture, Evidence Model, Gates, and SDLC Phases without changing prose.
4. Verify the Explanation section passes (GREEN).
5. Commit with message: "feat(docs): register explanation topics"

**Files:**
- `test/test_docs_navigation.sh`
- `docs/explanation/architecture.md`
- `docs/explanation/evidence-model.md`
- `docs/explanation/gates.md`
- `docs/explanation/sdlc-phases.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 8

### Task 10: Register every runbook in hosted navigation

**Story:** Story 3, both happy and negative paths
**Story:** Story 4, happy path 1 and negative path 1
**Type:** happy-path

**Steps:**
1. Add a failing assertion for unique `Runbooks` children and deterministic order.
2. Verify the runbook assertion fails (RED).
3. Add navigation front matter to all five recovery/runbook topics without changing prose.
4. Verify the Runbooks section passes (GREEN).
5. Commit with message: "feat(docs): register operational runbooks"

**Files:**
- `test/test_docs_navigation.sh`
- `docs/runbooks/daemon-recovery.md`
- `docs/runbooks/emergency-stop-a-running-feature.md`
- `docs/runbooks/shipped-record-reconciliation.md`
- `docs/runbooks/stalled-or-stuck-feature.md`
- `docs/runbooks/worktree-and-evidence-recovery.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 9

### Task 11: Register the first contributing group in hosted navigation

**Story:** Story 3, both happy and negative paths
**Story:** Story 4, happy path 1 and negative path 1
**Type:** happy-path

**Steps:**
1. Add a failing assertion that Code Organization, Extending, and Releases have unique titles under `Contributing` with deterministic order.
2. Verify the contributing-group assertion fails (RED).
3. Add the required front matter to the three topics without changing their prose.
4. Verify the scoped contributing group passes (GREEN).
5. Commit with message: "feat(docs): register core contributing topics"

**Files:**
- `test/test_docs_navigation.sh`
- `docs/contributing/code-organization.md`
- `docs/contributing/extending.md`
- `docs/contributing/releases.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 10

### Task 12: Complete contributing and quickstart navigation metadata

**Story:** Story 3, both happy and negative paths
**Story:** Story 4, both happy and negative paths
**Type:** happy-path

**Steps:**
1. Add failing assertions for Testing and Validation under `Contributing`, plus Quickstart as a unique top-level page.
2. Verify the assertions fail (RED).
3. Add navigation front matter to the remaining three topics without changing their prose.
4. Verify the Contributing section and Quickstart metadata pass (GREEN).
5. Commit with message: "feat(docs): complete topic navigation metadata"

**Files:**
- `test/test_docs_navigation.sh`
- `docs/contributing/testing.md`
- `docs/contributing/validation.md`
- `docs/quickstart.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 11

### Task 13: Wire the full navigation contract into harness integrity

**Story:** Story 4, both happy and negative paths
**Story:** Story 9, happy path 1 and negative path 1
**Type:** infrastructure

**Steps:**
1. Add a failing integration assertion that the integrity suite invokes the fixture-driven navigation test and that the test checks the real repository tree after its fixtures.
2. Verify the integration assertion fails (RED).
3. Add the real-tree invocation, register the navigation suite as the next numbered integrity check, and preserve concise pass/fail output with no network access.
4. Run `bash test/test_docs_navigation.sh`, `bash test/lint_shell.sh`, and the scoped integrity suite; verify all pass (GREEN).
5. Commit with message: "test(integrity): gate complete documentation navigation"

**Files:**
- `test/check_docs_navigation.sh`
- `test/test_docs_navigation.sh`
- `test/test_harness_integrity.sh`

**Wired-into:** `test/test_harness_integrity.sh#check_17_docs_site_contracts`

**Dependencies:** Task 12

### Task 14: Add the hosted documentation entry to the project front door

**Story:** Story 8, both happy and negative paths
**Story:** Story 1, happy path 1
**Type:** happy-path

**Steps:**
1. Add a failing source assertion that the Documentation section prominently links to the exact public landing URL while retaining all categorized in-repository links.
2. Verify the assertion fails (RED).
3. Add the hosted-site entry at the start of the Documentation section without removing or replacing source navigation.
4. Verify the front-door assertion and existing offline link check pass (GREEN).
5. Commit with message: "docs: link the hosted documentation front door"

**Files:**
- `test/test_docs_navigation.sh`
- `README.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 13

### Task 15: Add an opt-in post-merge Pages smoke probe

**Story:** Story 1, happy path 1 and negative path 1
**Story:** Story 5, happy path 1 and negative path 2
**Story:** Story 6, both happy and negative paths
**Story:** Story 7, both happy and negative paths
**Story:** Story 8, negative path 1
**Story:** Story 9, happy path 2 and negative path 2
**Type:** negative-path

**Steps:**
1. Write failing fake-adapter tests for: Pages source not `main:/docs`, public root non-200, missing site title/taxonomy marker, representative topic mismatch, and a failed/missing deployment status.
2. Verify the adapter tests fail without making a network request (RED).
3. Implement a clearly named opt-in smoke script whose default adapters call `gh` and `curl`, while tests inject deterministic fakes; report each failed external contract with a distinct non-zero result.
4. Verify fake success/failure cases pass and confirm the default aggregate suite never invokes the smoke script (GREEN). Do not require the real probe to pass until the spec implementation has merged and Pages has published it.
5. Commit with message: "test(smoke): verify published Pages documentation"

**Files:**
- `test/docs_pages.smoke.test.sh`
- `test/test_docs_pages_smoke.sh`
- `test/test_harness_integrity.sh`

**Wired-into:** `test/test_harness_integrity.sh#check_17_docs_site_contracts`

**Dependencies:** Task 14

## Task Dependency Graph

```text
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15
```

The sequence is intentionally linear because Tasks 1–15 share `test/test_docs_navigation.sh` or the integrity entry point; parallel execution would create avoidable file contention.

## Story Coverage Mapping

| Story / requirement | Happy-path tasks | Negative-path tasks |
|---|---|---|
| Story 1 / FR-1 | 4, 14, 15 | 2, 15 |
| Story 2 / FR-2 | 2, 4, 5 | 2, 5 |
| Story 3 / FR-3 | 4–12 | 3, 4, 6–13 |
| Story 4 / FR-4 | 3, 6–13 | 3, 6–13 |
| Story 5 / FR-5 | 4, 15 | 4, 15 |
| Story 6 / FR-6 | 4, 15 | 1, 15 |
| Story 7 / FR-7 | 4, 15 | 4, 15 |
| Story 8 / FR-8 | 14, 15 | 14, 15 |
| Story 9 / FR-9 | 1–3, 13, 15 | 1–3, 13, 15 |

## Integration Points

- After Task 3: the checker has full fixture coverage while remaining independent of the incomplete real tree.
- After Task 5: the public landing and top-level hierarchy are structurally complete.
- After Task 12: every current Markdown topic has deterministic navigation metadata.
- After Task 13: the complete real-tree contract is enforced by local and CI integrity.
- After Task 14: repository readers can reach the hosted site while retaining source navigation.
- After Task 15: post-merge publication has an explicit opt-in live verification path, with all default tests isolated by fakes.

## Verification

- [ ] `bash test/test_docs_navigation.sh` passes its fixtures and the real repository tree.
- [ ] `bash test/test_docs_pages_smoke.sh` passes with fake `gh` and `curl` adapters and performs no real network call.
- [ ] `bash test/lint_shell.sh` passes at the configured severity.
- [ ] `bash test/test_harness_integrity.sh` passes, including the new navigation/site-contract check.
- [ ] The existing offline documentation link check reports zero broken internal targets.
- [ ] Every happy and negative acceptance criterion maps to at least one task in the coverage table.
- [ ] All 15 tasks are 2–5 minute changes with explicit, acyclic dependencies.
- [ ] Every task carries a valid `Wired-into:` disposition derived from the architecture review.
- [ ] No default test invokes GitHub, HTTP, package registries, an LLM, or another third party.

## Verify-Claims Ledger

### Claims

- [verified] GitHub Pages currently publishes from `main:/docs`, so no deployment workflow task is required.
- [verified] The current corpus contains 29 Markdown topics across Quickstart, Guides, Reference, Explanation, Runbooks, and Contributing; Tasks 5–12 name every one.
- [verified] `test/test_harness_integrity.sh` already invokes focused Bash fixture suites and `test/lint_shell.sh` already covers root-level test scripts, matching the planned test seam.
- [verified] The existing CI links job validates local documentation links offline and remains independent of the new navigation check.
- [verified] The approved architecture review's production surfaces map to Tasks 4–15 and their `Wired-into:` lines.

### Assumptions

- [load-bearing, approved] The existing default-branch publisher remains the deployment authority; implementation adds only repository source/configuration and checks.
  - Impact if wrong: requires replacing Tasks 4 and 15 with a new deployment workflow and migration plan.
  - Confirmed by: operator selected Approach A and approved the ADR on 2026-07-30.
  - **Status: APPROVED by operator 2026-07-30**

Verdict: CLEAR
