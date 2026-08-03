# One-time release backlog transition audit

**Status:** consumed — operator-approved and applied

**Applied by:** the `chore/changelog-transition-0-99-20` pull request, by hand.
**Prepared from:** `v0.99.17..5e519da96` (the merge of [#1265](https://github.com/jstoup111/ai-conductor/pull/1265))
**Authority:** the operator curated this transition directly in `CHANGELOG.md` rather
than routing it through the first bot-generated release PR. `runReleasePrAction`'s
`transition` seam is therefore never exercised: the maintainer sees an empty
`[Unreleased]` and a published `## [0.99.20]` section, and renders every later release
from structured merged-PR metadata alone.

## Decision rule

This was the one permitted semantic-curation pass. The recurring release-PR maintainer
must not interpret, consolidate, or discard legacy prose; it renders only from
`Release-*` metadata declared in merged pull-request bodies.

An item is *included* when it has a final reader-facing outcome; *consolidated* when it
is folded into a broader included outcome; and *excluded* with a reader-facing reason.
No item remains unresolved.

## Exhaustive inventory

| Input | Count | Disposition | Evidence |
| --- | ---: | --- | --- |
| Legacy `[Unreleased]` bullet entries | 552 | consolidated | `CHANGELOG.md` lines 12–523 at the recorded source revision |
| Additional bullets stranded under interleaved `## Migration` headings | 2 | consolidated | `CHANGELOG.md` lines 524–4813 at the recorded source revision |
| Duplicate `## [Unreleased]` headings in published history | 2 | included | Retitled `## [Unversioned] — pre-0.99.4 development` and `## [Unversioned] — pre-0.4.0 development`; content preserved verbatim |
| Queued runnable `` ```bash migration `` fences | 19 | included | Moved verbatim, in source order, into the single `## Migration` section under `## [0.99.20]` |
| Post-tag commits | 1,588 | consolidated | `git rev-list v0.99.17..5e519da96` |

## Applied dispositions

**Consolidated (552 + 2 → 43 reader-facing entries).** The legacy queue was rewritten
into themed Added/Changed/Fixed/Removed entries under `## [0.99.20] - 2026-08-03`, each
citing the representative issues for its theme. Per-change granularity remains
recoverable from `git log v0.99.17..v0.99.20`.

**Excluded, with reasons.** These classes were dropped rather than folded in:

- *Net-zero churn* — behavior introduced and then removed inside this same window has no
  reader-facing outcome to report. This covers the semantic attribution verification lane
  and its `attribution_enforcement_cutover` / `attribution_judge_cutover` keys, the
  per-task evidence gate, the RTK install path, and the Serena integration. Each survives
  only as a single `Removed` entry naming its retirement.
- *Superseded within the window* — a fix and its own follow-up regression fix are reported
  as one outcome; `conduct-ts finalize-changelog-pr` entries are dropped entirely, since
  [#1265](https://github.com/jstoup111/ai-conductor/pull/1265) retired that command.
- *Specification-only* — "spec landed for #N" entries record DECIDE artifacts, not
  implementation, and the repository's own eligibility policy holds that they add no
  changelog entry.
- *Repository bookkeeping* — committed shipped-records, backfilled `Owner:` intake
  markers, `version_freeze` advances, and CI-config touch-ups are internal to this
  repository and not reader-facing.

## Operator approval record

The operator reviewed and approved the condensation aggressiveness (theme summary, with
net-zero churn removed), the migration-fence treatment (retain all 19 verbatim, in
order), and the version-drift resolution (a single `[0.99.20]` section; neither `0.99.18`
nor `0.99.19` was ever tagged, so integrity check 9c never asks for them).

This audit is consumed. Later releases are rendered from structured PR metadata only, and
no further transition request will be honored.
