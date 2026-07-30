# ADR: Use a pinned remote theme for Pages navigation

**Date:** 2026-07-30
**Status:** APPROVED
**Deciders:** Project operator and architecture review; approved 2026-07-30

## Context

The repository already publishes its documentation source from the default branch through GitHub Pages. Individual Markdown pages render successfully, but the site root returns 404 and the default presentation offers no site-wide topic navigation. The design must add a landing page and responsive navigation while preserving repository-owned Markdown, default-branch-only publication, and the existing branch-based publisher.

GitHub documents that branch publication can use a repository's `/docs` folder and automatically publishes changes pushed to the selected branch. GitHub also supports `jekyll-remote-theme` for themes outside its built-in set. Just the Docs documents a pinned remote-theme form, Jekyll 3 compatibility, and a responsive main navigation built from page titles and parent metadata.

Evidence:

- [GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub Pages Jekyll themes and remote-theme support](https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/adding-a-theme-to-your-github-pages-site-using-jekyll)
- [Just the Docs version-pinning guidance](https://github.com/just-the-docs/just-the-docs/blob/main/MIGRATION.md#pinning-the-theme-version)
- [Just the Docs main-navigation contract](https://just-the-docs.com/docs/navigation/main/)

## Options Considered

### Option A: Pin Just the Docs as a remote theme on the existing branch publisher

- **Pros:** Preserves the already-working publication topology; provides responsive sidebar navigation; keeps source Markdown in place; pins presentation behavior to a released version; requires no deployment workflow or generated site output.
- **Cons:** Adds a third-party build-time dependency; every navigable page needs site metadata; remains on GitHub's legacy Jekyll branch-build path.

### Option B: Own a custom Jekyll layout and navigation

- **Pros:** No third-party theme dependency; complete control over markup and styling; preserves branch publication.
- **Cons:** The repository must design and maintain responsive navigation, accessibility, layout, and styling; increases custom code for a presentation problem already solved by documentation themes.

### Option C: Replace branch publication with an Actions-built documentation generator

- **Pros:** Explicit versioned build pipeline; broader generator and plugin choice; straightforward local-build parity.
- **Cons:** Replaces an already-working publisher, adds workflow permissions and dependencies, requires repository Pages-setting migration, and exceeds the operator's main-only availability need.

## Decision

Choose Option A.

1. Preserve the existing GitHub Pages source: the default branch's repository documentation directory. Do not add or migrate to a deployment workflow.
2. Pin Just the Docs remote theme release `v0.12.0`; never follow the theme's moving default branch.
3. Add a site landing page, site configuration, section index pages, and navigation metadata on every published topic. Navigation uses unique page titles and explicit parent relationships so every existing topic appears in the sidebar hierarchy.
4. Keep all prose in the existing Markdown pages. Site configuration and front matter are presentation metadata, not a second content source.
5. Add a deterministic repository validation that enumerates published Markdown and fails when the landing page, pinned theme, required title/parent metadata, or navigation coverage is missing. Wire it into the existing harness integrity suite; retain the existing internal-link checker for link targets.
6. Link the hosted landing page prominently from the root project overview while retaining in-repository topic links for source readers.
7. Treat GitHub's Pages deployment status as the post-merge publication signal. Default automated tests remain offline; any live URL probe is opt-in smoke/manual verification because GitHub is a third-party boundary.

## Consequences

### Positive

- The public documentation root becomes useful without changing publication ownership or branch semantics.
- Desktop and mobile navigation come from a maintained documentation theme instead of repository-owned layout code.
- A pinned release prevents unreviewed theme changes from altering or breaking the site.
- Deterministic local validation prevents newly added topics from silently becoming orphaned.
- Documentation remains edited and reviewed in the same feature pull requests as the behavior it describes.

### Negative

- Adding or moving a topic requires maintaining navigation front matter.
- Site builds depend on GitHub fetching the pinned remote theme.
- The branch publisher uses GitHub's supported but non-preferred legacy Jekyll path; a future migration may be needed if GitHub retires it or the site needs unsupported build customization.
- The complete hosted result can only be observed after a change reaches the publication branch; pull-request checks prove source structure and links, not GitHub's external availability.

### Follow-up Actions

- [ ] Add the pinned site configuration and documentation landing page.
- [ ] Add section index pages and navigation metadata to every current topic.
- [ ] Add and wire the deterministic navigation-contract validation.
- [ ] Update the root project overview and contributor validation reference.
- [ ] Verify the public root and representative navigation paths after publication.

## Verify-Claims Ledger

### Claims

- [verified] The repository Pages API reports a built, public site sourced from the default branch's documentation directory — observed 2026-07-30.
- [verified] The site root returns HTTP 404 while an existing topic returns HTTP 200 from Jekyll — observed through live requests 2026-07-30.
- [verified] GitHub supports automatic branch publication from `/docs` and supports non-built-in Jekyll themes through `jekyll-remote-theme` — official GitHub documentation cited above.
- [verified] Just the Docs v0.12.0 documents a pinned remote-theme reference and responsive title/parent-driven navigation — official theme repository and documentation cited above.
- [verified] No open branch overlap was detected on the planned site, validation, and project-overview paths — `conduct-ts overlap-scan` on 2026-07-30.

### Assumptions

- [load-bearing, approved] Retain the existing default-branch publisher when it achieves the complete URL and navigation outcome.
  - Impact if wrong: requires Option C and a different publishing topology.
  - Confirmed by: operator selected Approach A and stated only Pages for the default branch is needed on 2026-07-30.
  - **Status: APPROVED by operator 2026-07-30**

Verdict: CLEAR
