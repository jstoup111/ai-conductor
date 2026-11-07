# ADR: Decision-corpus query and known record shapes

**Date:** 2026-11-07
**Status:** APPROVED (operator, 2026-11-07)
**Deciders:** James Stoup (operator), composer DECIDE for #1480

## Context

The founding record `.docs/decisions/001-harness-architecture.md` is `Status: Accepted` and still
decides "a pure Markdown skills + agent personas repository … No custom runtime." The repository
has carried the `src/conductor` engine for months. A #742 amendment note on that record mentions
the engine only in passing, so a reader who starts at record 001 is told the opposite of the truth.
Verified on main @ `9c523e1e1a`.

The corpus around it is hard to navigate. `.docs/decisions/` holds about 770 files: about 364
`adr-YYYY-MM-DD-*` decision records, about 373 `architecture-review-*` transcripts and 34 files
under other names (`001-`–`005-`, `adr-002`–`adr-015`, `2026-06-29-*`, `review-*`,
`technical-assessment-*` and others). It has no index. Status words vary (`APPROVED`, `Approved`,
`Accepted`, `ACTIVE`, `Proposed`, `SUPERSEDED`), and reviews use `Verdict:` instead of `Status:`.

Three constraints shape the design:

- **Builds cannot edit the corpus.** `.docs/decisions` is listed in
  `PROTECTED_ARTIFACT_DIRECTORIES` (`protected-artifact-seal.ts`). Any change to existing records
  has to ride the spec PR through composer `land`.
- **Land refuses renamed legacy ADRs.** Land treats a renamed `adr-*` file as newly added, so it
  must have the canonical `adr-YYYY-MM-DD-*` name, a citable decision and an assumption ledger
  (`land-spec.ts`, ADR hard gates). A mass rename would rewrite 34 historical records.
- **Other harness writers put non-prefixed files in the corpus.** In consumer repositories, the
  `prd` skill writes `.docs/decisions/api-response-contract.md` and the `bootstrap` skill writes
  `.docs/decisions/styleguide.md`. Consumer repositories may also carry their own legacy ADRs under
  any name.

The engine already distinguishes most records by filename prefix (`adr-*` for the land and plan-review
gates, `architecture-review-*` and `technical-assessment-*` for artifact contracts). It already has one
disposition reader, `adrApprovalStatus` (`artifacts.ts`). The manifest kind table
`MANIFEST_KIND_LOCATIONS` (`feature-manifest.ts`) records where the `decision` kind lives. That table
is the seam the per-feature layout work (#3419) and the ADR-relocation proposal (#782) would change.

## Options Considered

### Option A: Committed index regenerated in each PR, with a freshness check
- **Pros:** Anyone can browse it on GitHub without running a command.
- **Cons:** Nearly every spec adds an ADR, so parallel spec PRs and daemon builds would keep
  conflicting on one file.

### Option B: On-demand read-only query command (chosen)
- **Pros:** It can never go stale and never causes merge conflicts. It reads records through the
  engine's own prefix and status rules, so it cannot disagree with the gates.
- **Cons:** Someone has to run it; there is no page to browse. It adds a CLI subcommand.

### Option C: Bot-maintained committed index, regenerated after merge
- **Pros:** Browsable, and feature PRs don't conflict on it.
- **Cons:** It lags main until the bot PR merges. It needs new GitHub Actions machinery and splits
  classification between CI and the engine.

### Option D: Rename and normalize legacy records
- **Pros:** Every file would follow one convention.
- **Cons:** Blocked by land's ADR gates and the protected seal. It would also break existing
  citations and rewrite history.

### Option E: Supersede record 001 with a new current-architecture record
- **Pros:** Follows the "supersede, don't delete" convention, and the original text stays in the
  corpus.
- **Cons:** The operator chose deletion. Everything in 001 that still holds (separate `agents/`
  personas, the `tech-context/` layer, enforcement levels) is already documented in
  `ARCHITECTURE.md`. Its planning-skill choice was replaced by the current DECIDE flow, and its
  retrospective choice was retired by #1905, so a replacement record would hold nothing new.

## Decision

1. **Delete `001-harness-architecture.md` in the spec PR, with no replacement record.** This is an
   explicit, operator-authorized exception to the "ADRs are append-only" convention, and it applies
   to this record only. Git history keeps the original reasoning. No other record is deleted. Each
   record that cites 001 gets an additive `> **Amended 2026-11-07 by #1480:**` note beside the
   citation, saying 001 was deleted and pointing to this ADR; the original text is not rewritten.
   Those records are two `architecture-review-*` transcripts,
   `.docs/conflicts/2026-08-26-remove-retrospectives-full-and-micro-from-feature-.md` and
   `adr-2026-09-28-skills-may-bundle-executable-helpers`. The amendment to that ADR adds no decision
   and changes none.

2. **One closed table of known record shapes classifies every record.** Kind is decided by the
   first rule that matches, and no table entry is specific to a repository:
   - filename prefix `adr-` → `decision`
   - filename prefix `architecture-review-` or `review-` → `review`
   - filename prefix `technical-assessment-` → `assessment`
   - exact name `api-response-contract.md` or `styleguide.md` → `reference`
   - otherwise, content: a `Status:` line → `decision`, a `Verdict:` line → `review`
   - otherwise → `unclassified`

   The query and the land gate both read this one table. Adding a new shape means editing the
   table, nothing else.

3. **Disposition is one mechanical rule.** For records carrying a `Status:` line, disposition comes
   from the existing `adrApprovalStatus`: `approved`, `superseded`, or `other` (the declared word
   is kept for display). Reviews take their `Verdict:` word, and a record with neither line is
   `undeclared`. An `undeclared` or `other` disposition is reported, never an error. No new status
   parser is introduced.

4. **`ai-conductor decisions` is the index, run on demand.** It is a read-only CLI subcommand,
   registered in the CLI command table, that lists one row per record: kind, disposition, date,
   title and a one-line decision summary. It filters by `--kind`, `--status` and a free-text term.
   It writes nothing, needs no configuration, and exits 0 with an empty list when the repository
   has no corpus. No index file is committed, and no bot maintains one.

5. **Corpus locations come from the manifest kind table.** The query and the land gate resolve the
   corpus directory through `MANIFEST_KIND_LOCATIONS`, never a hard-coded path. A later layout move
   (#3419) or ADR relocation (#782) updates that table and the query follows. A move that takes
   review records out of the table's reach is that spec's responsibility to register.

6. **Land refuses newly added off-shape corpus files.** Land checks only files the change set
   **adds** to the corpus (porcelain status `A` or untracked). A file that matches no known shape
   (decision 2's prefix and exact-name rules) is refused, and the refusal names the file and the
   accepted shapes. Modified and deleted records, and every existing record in every repository,
   are grandfathered. The existing ADR hard gates are unchanged.

7. **No existing record is renamed or rewritten.** Legacy records keep their names and text. They
   become findable through the content rule in decision 2 and the query in decision 4.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Land's `git add -- .docs` stages the deletion of the tracked `001-harness-architecture.md`, so the spec PR carries it. | inferred | 95% | yes | 001 survives the merge; the plan would need a different delivery for the deletion. | APPROVED by operator 2026-11-07 |
| A2 | No engine code, skill or test reads `001-harness-architecture.md`; only four `.docs` records cite it. | verified | 98% | yes | Deletion breaks a reader. | APPROVED by operator 2026-11-07 |
| A3 | The harness writes only `adr-*`, `architecture-review-*`, `technical-assessment-*`, `api-response-contract.md` and `styleguide.md` into the corpus. | verified | 90% | yes | Land refuses a legitimate harness-generated file in some repository. | APPROVED by operator 2026-11-07 |
| A4 | #3419 keeps ADRs in `.docs/decisions/` and routes any relocation through `MANIFEST_KIND_LOCATIONS`. | inferred | 80% | yes | The query misses relocated records until that spec extends the table. | APPROVED by operator 2026-11-07 |
| A5 | The content rule classifies every one of the 34 off-convention records in this repository, with one misclassification (`per-feature-token-accounting-review.md` as `decision`). | verified | 95% | no | A few records show as `unclassified`; still findable. | — |

## Consequences

### Positive
- A reader starting at the corpus no longer meets a record that denies the engine exists.
- One command finds the record for a subject without opening hundreds of files, and it works the
  same in consumer repositories.
- Decision records and review transcripts are told apart by a single rule, and so are their
  dispositions.
- New corpus files cannot drift from the known shapes.

### Negative
- The index has to be run; you can't browse it on GitHub.
- The deletion breaks with the append-only ADR convention. Four records now cite a deleted file,
  each with an amendment note explaining why.
- Amending an on-main ADR brings its decisions into this spec's coherence obligations at land.
- A new harness writer into the corpus must add its shape to the table, or land refuses its
  output.
- The new subcommand is an additive `bin/conduct` CLI surface, so the PR needs a migration block or
  a release waiver.

### Follow-up Actions
- [ ] Comment on #3419 and #782: corpus location is read from `MANIFEST_KIND_LOCATIONS`, and a
      relocation must keep the known-shapes table and that kind table in step.
