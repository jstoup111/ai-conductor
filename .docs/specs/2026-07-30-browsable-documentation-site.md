# PRD: Browsable Documentation Site

**Date:** 2026-07-30
**Status:** Approved

## Problem / Background

AI Conductor's detailed documentation is maintained in the repository and individual pages are already published, but the public documentation URL has no landing page and returns a not-found response. Readers who reach an individual page also lack site-wide topic navigation. This leaves newcomers dependent on the repository file browser and weakens the discoverability gained by moving detailed guidance out of the root project overview.

## Goals & Non-Goals

**Goals**

- Give readers a stable public documentation URL that opens to a useful landing page.
- Make every published topic discoverable through clear, site-wide navigation.
- Keep the repository-owned documentation as the single source of truth.
- Publish documentation updates automatically after they merge to the default branch.
- Direct readers from the project overview to the hosted documentation site.

**Non-Goals**

- Rewriting or materially reorganizing the documentation content.
- Publishing previews from pull requests or non-default branches.
- Adding a custom domain, analytics, comments, or a separate documentation repository.
- Adding documentation search unless it is an incidental capability of the selected presentation approach.

## Users / Personas

- **Prospective user:** evaluates AI Conductor and needs to understand its purpose, installation, and workflow without navigating repository folders.
- **New operator:** follows the quickstart and task-oriented guides while adopting the harness.
- **Experienced operator or contributor:** reaches exact reference, explanation, contributing, or recovery material quickly.

## Functional Requirements

- **FR-1:** The public documentation URL must return a successful page containing a recognizable AI Conductor documentation landing experience rather than a not-found response.
- **FR-2:** The landing page must provide links to quickstart, guides, reference, explanation, runbooks, and contributing material.
- **FR-3:** Every published documentation page must expose persistent navigation that lets a reader reach the landing page and each top-level documentation section without returning to the repository file browser.
- **FR-4:** Every existing human-facing documentation topic must be reachable through the hosted site's navigation, with no orphaned topic pages.
- **FR-5:** The hosted content must be rendered from the same repository-owned Markdown maintained in feature pull requests; the feature must not introduce a second content source or out-of-repository editing surface.
- **FR-6:** A documentation change merged to the default branch must publish automatically without a manual release action.
- **FR-7:** Changes that have not merged to the default branch must not replace the public documentation site.
- **FR-8:** The root project overview's Documentation section must link prominently to the hosted documentation landing page while retaining useful in-repository navigation for source readers.
- **FR-9:** Navigation links and the hosted landing page must resolve successfully; a publishing or link failure must be visible through repository checks rather than silently reported as a successful delivery.

## Non-Functional Requirements

- The hosted site must use HTTPS at its public URL.
- Navigation must remain usable on both narrow mobile viewports and desktop viewports.
- Routine documentation maintenance must continue through ordinary repository pull requests.

## Acceptance Criteria / Success Metrics

- The public documentation root returns HTTP 200 and presents the documentation landing page.
- A reader can reach every current documentation topic starting from the landing page.
- From any current topic page, a reader can return to the landing page and navigate to every top-level section.
- After a representative documentation edit merges to the default branch and publishing completes, the live page reflects the merged text without a manual publish operation.
- The project overview's hosted-documentation link resolves to the successful landing page.
- Repository verification detects broken internal documentation links and a failed site publication path.
- No documentation content is authored or stored outside the repository's normal pull-request workflow.

## Scope

### In Scope

- A hosted documentation landing experience.
- Site-wide navigation covering all existing documentation topics.
- Automatic default-branch publication using the repository's existing hosted-pages capability.
- A prominent hosted-site link from the root project overview.
- Repository checks that protect navigation integrity and publication readiness.

### Out of Scope

- Pull-request preview sites or publication from feature branches.
- Custom domains, usage analytics, comments, authentication, or personalized content.
- A separate wiki or documentation repository.
- Broad editorial rewriting of existing guides and references.

## Key Decisions & Rationale

- The repository remains the sole documentation source so docs continue to change atomically with the features they describe.
- Only default-branch content is public because the operator needs one authoritative documentation site, not preview environments.
- Existing publication capability should be completed rather than replaced when it can satisfy availability and navigation outcomes with less operational surface.

## Dependencies

- The repository's existing public GitHub Pages site and default-branch publication setting.
- The documentation tree established by issue #787.

## Open Questions

- Which presentation approach provides durable site-wide navigation with the least maintenance and dependency risk? Architecture review must compare the native hosted-site options before approving the mechanism.
- What deterministic check should prove that every maintained topic remains represented in site navigation as the documentation tree evolves?

## Verify-Claims Ledger

### Claims

- [verified] Individual documentation pages are publicly rendered, while the public documentation root returns not found — observed through live HTTP requests on 2026-07-30.
- [verified] Existing publication is configured for the default branch and the repository documentation source — observed through the GitHub Pages API on 2026-07-30.
- [verified] The current documentation corpus contains quickstart, guides, reference, explanation, runbooks, and contributing material — observed in the isolated worktree on 2026-07-30.

### Assumptions

- [load-bearing, approved] The existing default-branch publisher may be retained if it satisfies the complete availability and navigation outcome.
  - Impact if wrong: architecture would need a replacement publication pipeline and a different acceptance path.
  - Confirmed by: operator selected Approach A and stated that only Pages for the default branch is needed on 2026-07-30.
  - **Status: APPROVED by operator 2026-07-30**

Verdict: CLEAR
