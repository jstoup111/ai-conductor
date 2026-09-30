# Stories: GitHub issue ↔ PR linkage + auto-close

**Status:** Accepted
**Spec:** .docs/specs/intake-issue-pr-link-autoclose.md

## Story 1 — Spec carries its issue origin (FR-1)

**As** the intake pipeline, **I want** the originating issue ref committed alongside the spec
**so that** the daemon can later reference it on the implementation PR.

- **Happy:** Given an envelope with `sourceRef = "acme/app#49"`, when the spec is authored
  (`runAuthoring`) or landed (`landSpec`), then `.docs/intake/<slug>.md` exists on the spec
  branch containing the line `Source-Ref: acme/app#49`, committed in the spec commit.
- **Negative (no sourceRef):** Given authoring/landing with no `sourceRef` and no explicit additional closure targets (hand-authored
  spec), when the spec is committed, then NO `.docs/intake/<slug>.md` is written and the
  commit is unchanged from today.
- **Negative (malformed ref):** Given a `sourceRef` that is truly malformed — matching
  neither `owner/repo#<digits>` nor a valid Jira key (e.g. `proj_123!`, `not-a-ref`) —
  when authoring/landing runs, then the malformed value is NOT written (treated as absent)
  and the run does not throw.
  Valid Jira keys (`PROJ-123`) are written losslessly; only genuinely malformed origins
  are treated as absent. Additional closure declarations have their own strict GitHub validation.

## Story 2 — Spec PR links without closing (FR-2, FR-6, FR-7)

**As** an operator, **I want** the spec PR to reference the issue (not close it)
**so that** the link appears immediately but the issue stays open until code ships.

- **Happy:** Given a known `sourceRef`, when `openSpecPr` creates the spec PR, then the PR
  body contains `Refs acme/app#49` and contains NONE of `Closes`/`Fixes`/`Resolves`.
- **Negative (no sourceRef):** Given no `sourceRef` and no explicit extras, when the spec PR is created, then the
  body is composed exactly as today (no `Refs` line injected).
- **Negative (idempotent):** Given a spec PR body that already contains `Refs acme/app#49`,
  when injection runs again, then the line is not duplicated.
- **Negative (gh write-back fails):** Given the gh body edit fails (outage / no remote),
  when injection runs, then the error is logged and the created spec PR is still returned
  (non-fatal).

## Story 3 — Daemon resolves the issue origin (FR-3, FR-5)

**As** the daemon, **I want** to read the issue ref from the merged spec
**so that** I can put it on the implementation PR.

- **Happy:** Given `.docs/intake/<slug>.md` with `Source-Ref: acme/app#49` on the base
  branch, when `discoverBacklog` builds the item, then `BacklogItem.sourceRef === "acme/app#49"`.
- **Negative (absent file):** Given no `.docs/intake/<slug>.md` on the base branch, when
  `discoverBacklog` runs, then the item is still produced with `sourceRef` undefined and the
  feature remains buildable.
- **Negative (garbled content):** Given `.docs/intake/<slug>.md` present but with no valid
  `Source-Ref:` line (neither GitHub ref nor Jira key),
  when parsed, then `sourceRef` is undefined (no throw).

## Story 4 — Implementation PR closes the issue (FR-4, FR-6, FR-7)

Implementation linkage follows the complete approved origin-plus-extras set. Older watched
signatures do not downgrade these targets to non-closing references. A missing origin alone
never suppresses explicit additional targets. Independently enrolled watches are outside this
publication operation.

**As** an operator, **I want** the daemon implementation PR to close the issue on merge
**so that** completed work is reflected on the issue tracker automatically.

- **Happy:** Given a `BacklogItem` with `sourceRef = "acme/app#49"`, when the daemon's
  implementation PR is created/finalized, then its body contains `Closes acme/app#49`, so
  merging it to the default branch auto-closes the issue.
- **Negative (no sourceRef):** Given an item with `sourceRef` undefined and no explicit extras, when the
  implementation PR is finalized, then no closing keyword is injected and the PR is unchanged.
- **Negative (idempotent):** Given an implementation PR body already containing
  `Closes acme/app#49`, when injection runs again, then it is not duplicated.
- **Negative (gh edit fails):** Given the gh body edit fails, when injection runs, then the
  error identifies incomplete/refused linkage, the existing PR and declarations remain intact,
  and common FINISH recovery must verify the complete set before claiming publication complete.

- **Negative (extras only):** Given no origin and valid explicit extras, when authoring and handoff run, then their marker is retained and the spec PR has non-closing references; implementation FINISH verifies closing references for all extras.
