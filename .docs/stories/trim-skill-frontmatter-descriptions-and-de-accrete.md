# Stories — Trim skill descriptions & de-accrete writing-system-tests

**Source:** `jstoup111/ai-conductor#327` · **Track:** technical · **Tier:** S

Scope note: these stories describe changes to authoring artifacts (`SKILL.md`). "The
system" here is the harness's validation suite plus the router that reads descriptions.
Acceptance is verified by content inspection, word counts, and
`test/test_harness_integrity.sh`.

---

## Story 1 — Descriptions carry only a "use when X" clause

**As** a harness maintainer, **I want** the `engineer`, `explore`, and `remediate` skill
descriptions trimmed to a single when-to-fire clause **so that** the router matches on
routing intent, not internal procedure, and each turn wades through less noise.

### Acceptance criteria

- **Happy — engineer trimmed.**
  - *Given* `skills/engineer/SKILL.md` whose description embeds the full DECIDE sequence
    (`explore → complexity → prd → architecture-diagram → architecture-review → stories →
    conflict-check → plan`),
  - *When* the change is applied,
  - *Then* the description is a single "use when capturing/routing a raw idea into a spec
    PR" clause of roughly 25 words (materially shorter than the original ~80), contains no
    arrow-joined step sequence, and the removed DECIDE detail is present in the skill body.

- **Happy — explore trimmed.**
  - *Given* `skills/explore/SKILL.md` whose description ends with the changelog clause
    "Divergent half of the old brainstorm — produces no committed design doc; the
    product-track PRD is authored by /prd.",
  - *When* the change is applied,
  - *Then* that trailing changelog clause is gone and the description states only when to
    fire (start of a new feature/change: explore context, clarify, propose approaches,
    decide track).

- **Happy — remediate trimmed.**
  - *Given* `skills/remediate/SKILL.md` whose description enumerates routing targets
    `(build/acceptance_specs/architecture_review/plan)`,
  - *When* the change is applied,
  - *Then* the parenthetical routing-target enumeration is removed from the description
    (it already lives in the body) and the description states only when to fire (SHIP,
    when prd-audit / as-built architecture review / finish verification blocks).

- **Negative — routing preserved (no over-trim).**
  - *Given* the three trimmed descriptions,
  - *When* each skill's intended trigger occurs (idea→spec routing; start-of-feature
    exploration; a blocked SHIP gate),
  - *Then* the skill still routes correctly on its intended trigger — the trim removed
    procedure, not the distinguishing when-to-fire signal.

- **Negative — required frontmatter intact.**
  - *Given* the edited frontmatter blocks,
  - *When* `test/test_harness_integrity.sh` runs,
  - *Then* every skill still has the required fields (`name`, `description`,
    `enforcement`, `phase`) and the suite passes; the model table and `model:` pins are
    unchanged.

---

## Story 2 — `writing-system-tests` `## Process` uses a clean sequential numbering scheme

**As** a harness maintainer, **I want** the accreted `## Process` numbering
(`1, 2, 2.5, 3, 3.5, 3a, 3b, 3c, 3d, 3e, 4, 5a, 5b, 6, 7`) reorganized into a clean
sequential scheme **so that** the section reads as a designed sequence, not a pile of
bolt-ons, lowering maintenance cost.

### Acceptance criteria

- **Happy — no accretion suffixes remain.**
  - *Given* the current `## Process` headers with `.5` and `a–e` suffixes,
  - *When* the change is applied,
  - *Then* every `## Process` sub-step header is a clean sequential number
    (`### 1` … `### N`) with no `.5` or letter suffix, in the same logical order as before.

- **Happy — content parity (pure reorganization).**
  - *Given* the body text under each pre-change section,
  - *When* the reorg is applied,
  - *Then* no substantive body content is deleted or reworded — only headers/numbering
    change (parallel sub-steps may be regrouped under a numbered parent as unnumbered
    `####` sub-headings). Verifiable by word-count/content parity of body prose.

- **Negative — no duplicate section numbers.**
  - *Given* the renumbered file,
  - *When* `test/test_harness_integrity.sh` runs its "no duplicate section numbers within
    a SKILL.md" check,
  - *Then* the check passes (the new scheme introduces no collisions).

- **Negative — cross-references stay valid.**
  - *Given* in-body references to steps (e.g. "see §1"),
  - *When* the reorg renumbers sections,
  - *Then* any such internal reference is updated to point at the correct new number (no
    dangling "see §N" pointing at a section that moved).

---

## Story 3 — Framework-deference rule stated exactly once

**As** a harness maintainer, **I want** the "the test framework and paths are the
project's, not this skill's" rule stated once in `writing-system-tests` **so that** there
is a single source of truth and fewer redundant tokens the fresh-context agent re-reads.

### Acceptance criteria

- **Happy — single canonical statement.**
  - *Given* the rule is currently asserted as a standalone restatement in at least two
    places (the "language- and framework-agnostic" paragraph near the Overview and the
    "**The test framework and paths are the project's, not this skill's.**" line above the
    stack-mapping table),
  - *When* the change is applied,
  - *Then* exactly one canonical standalone statement of the rule remains; the duplicate
    standalone restatement is removed or reduced to a short back-reference to the
    canonical one.

- **Negative — operational uses preserved.**
  - *Given* the many in-step phrasings that *use* project conventions operationally
    (e.g. "place specs per the project's layout", "per the framework's request test
    layer"),
  - *When* the deduplication is applied,
  - *Then* those step-level operational instructions are left intact — only the redundant
    *standalone rule statement* is collapsed, not the working instructions that depend on it.

- **Negative — routing description unaffected.**
  - *Given* the frontmatter `description` mentions "the project's own test framework and
    directory conventions" as part of its when-to-fire summary,
  - *When* the dedup is applied to the body,
  - *Then* the description is not counted as a duplicate to remove — it remains as the
    routing summary.

---

Status: Accepted
