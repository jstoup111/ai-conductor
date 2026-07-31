# Architecture Review: Browsable Documentation Site

**Date:** 2026-07-30
**Stories reviewed:** None; approved PRD and architecture diagram reviewed before stories
**Mode:** Lightweight (tier M)
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** PASS. GitHub's official documentation supports the repository's existing branch-from-documentation publication path and remote Jekyll themes. Just the Docs v0.12.0 explicitly supports a pinned remote-theme reference and Jekyll 3 navigation. Confidence 99% (verified primary documentation and live repository settings).
- **Prerequisites:** PASS. The public Pages site, HTTPS URL, and default-branch source already exist. The missing surfaces are repository files and metadata. Confidence 99% (verified Pages API and live HTTP behavior).
- **Integration surface:** BOUNDED. The change touches hosted-site configuration, documentation metadata, the root project overview, and repository validation; it does not touch the conductor runtime or consumer installation. Confidence 98% (verified repository layout and scope-check).
- **Data implications:** PASS. No application data, schema, migration, or backfill.
- **Performance:** PASS. The public site is static. The added validation enumerates a bounded Markdown tree and performs local parsing only.
- **Worktree isolation:** PASS. Authoring and validation use repository files only; no ports, databases, shared mutable services, or per-worktree publication occur.

## Alignment

- **Deterministic where possible:** PASS. Navigation completeness is enforced by a local validation wired into the integrity suite, rather than relying on authors to remember front matter. GitHub remains responsible only for the external build and hosting boundary.
- **Repository scope:** PASS. The change is repository-local CI/documentation presentation and does not alter `HARNESS.md`, installed skills, consumer configuration, or provider behavior.
- **Documentation source of truth:** PASS. Existing Markdown stays authoritative; presentation metadata and a pinned theme do not create a second authoring surface.
- **Test isolation:** PASS. Default validation remains offline. Live hosted-URL checks are smoke/manual only and excluded from the default suite.
- **Publishing boundary:** PASS. Only default-branch content reaches the configured public site; pull requests validate but do not publish.
- **Dependency discipline:** PASS. The theme is pinned to `v0.12.0`, avoiding an unreviewed moving-branch dependency.
- **Diagram accuracy:** PASS. The approved diagram shows contributor, repository checks, default branch, Pages/Jekyll, pinned theme, README entry point, and public reader flow.

## Wiring Surface

| New or changed production surface | Production caller |
|---|---|
| Hosted-site configuration with pinned remote theme | Consumed by GitHub Pages' Jekyll build after a push reaches the configured default-branch documentation source |
| Documentation landing page | Emitted as the public site root by the existing Pages publisher |
| Section indexes and page navigation metadata | Consumed by Just the Docs while generating the desktop sidebar and mobile menu |
| Navigation-contract validation | Invoked by the repository's harness integrity suite and therefore by the existing CI integrity job |
| Hosted-documentation link in the root project overview | Followed by readers from the repository landing page to the public site |
| Existing internal-link validation inputs | Continue to be consumed by the existing always-run CI links job |

**Early overlap scan:** `conduct-ts overlap-scan` reported no overlap and no open blockers for the planned site configuration, documentation tree, root overview, validation script, integrity suite, and validation reference. Rename/name-only limitations remain advisory.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Theme upstream changes break presentation | Integration | Low | Medium | Pin `v0.12.0`; upgrades require reviewed diffs and validation |
| A new topic is omitted from navigation | Technical | Medium | Medium | Enumerate all published Markdown in deterministic navigation-contract validation |
| Legacy branch publisher is eventually retired | Infrastructure | Low | Medium | Keep the publishing boundary isolated; supersede this ADR and migrate only when GitHub requires it |
| External Pages build fails only after merge | Integration | Low | Medium | Preserve pre-merge source/link checks; use Pages deployment status plus opt-in live verification after publication |
| Front-matter rollout creates central-doc conflicts | Integration | Low | Medium | Current overlap scan is clean; keep metadata edits mechanical and reviewable |

## ADRs Created

- `adr-2026-07-30-pinned-remote-theme-for-pages-navigation` — APPROVED by the operator on 2026-07-30

## Conditions

None.

## Blocking Issues

None.
