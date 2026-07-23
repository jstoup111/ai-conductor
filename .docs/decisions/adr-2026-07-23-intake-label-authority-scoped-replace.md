# ADR: Intake label authority — explicit > existing > default, applied by namespace-scoped replace

**Date:** 2026-07-23
**Status:** APPROVED
**Deciders:** Operator (jstoup111), via /engineer DECIDE for #889
**Source:** jstoup111/ai-conductor#889

<!-- Filename stem is the identifier: adr-2026-07-23-intake-label-authority-scoped-replace -->

## Context

Two independent writers stamp `priority:`/`size:` labels onto the same intake issue:

1. `bin/intake-file` → `src/intake-file-cli.ts` → `file-issue.ts`, which resolves a value
   (given ▸ prompt ▸ infer ▸ default) and applies it right after `gh issue create`.
2. `.github/workflows/intake-label-sync.yml` (`on: issues [opened, edited]`) →
   `scripts/intake-label-sync-apply.mts` → the shared seam
   `src/engine/engineer/intake/label-sync.ts` `syncIssueLabels`.

Both terminate in the **same** seam, and that seam applies labels with `addLabel` from
`pr-labels.ts` — a plain `POST /repos/{o}/{r}/issues/{n}/labels`, which is **additive**
(label-sync.ts:114-115, verified).

The apply script's `extractField` (intake-label-sync-apply.mts:33-40, verified) matches
only `^###\s+<Heading>$` — the GitHub **issue-form** rendering. A body authored by
`bin/intake-file` uses `## Observed` / `## Impact` / `## Desired outcome` and contains no
`### Priority` or `### Size` heading at all, so `extractField` returns `undefined` and the
seam falls through to `DEFAULT_PRIORITY = 'medium'` / `DEFAULT_SIZE = 'M'`
(label-sync.ts:56-57, verified). Those defaults are then **added on top of** whatever the
CLI already applied.

Verified live on this very issue: #889 was filed with `--size S --priority medium` and now
carries `priority: medium`, `size: S`, **and** `size: M`. Priority escaped duplication only
because the explicit choice happened to equal the default. A survey of all 109 open issues
found **23** with a duplicated `priority:` and/or `size:` namespace, and in **every one of
the 23** exactly one member of each duplicated namespace is the default value
(`priority: medium` / `size: M`) — consistent with the mechanism above and with the
workflow-run timing recorded in #889.

Meanwhile the workflow's own header comment asserts:

> "The apply script diffs the desired label set against the issue's current labels and
> calls the 'set labels' REST endpoint (a full replace) only when they differ, so re-edits
> never duplicate labels."

No such diff and no such call exist anywhere in the code. This is the doc-vs-code
contradiction #889 identified, and it is the reason the defect survived review: the
acceptance test that claims to cover idempotency
(`test/acceptance/intake-form-label-sync.test.ts`, "re-edit with identical values is
idempotent") only re-runs the seam with the **same** values and asserts the second run's
applied set equals the first's. It is green today, while the bug is live, because it never
exercises the only case that breaks — a computed value that **differs** from a label
already on the issue.

### Which path is defective

The **issue-form path is working as intended** and must not change: its bodies parse, the
seam resolves the submitted value, and re-editing re-applies the identical label
(server-side POST of an existing label is a no-op). The **CLI path is defective** — but the
defect is not "the parser doesn't know the CLI's body shape". It is that the seam has *no
concept of label authority*: it cannot distinguish "the operator explicitly chose medium"
from "nothing parsed, so medium is my fallback", and it writes both the same way.

## Decision

Two changes, one contract.

### 1. `syncIssueLabels` gains a three-tier authority rule and converges by scoped replace

For each namespace (`priority:`, `size:`) independently:

| Tier | Condition | Outcome |
|---|---|---|
| **explicit** | the caller passed a value in the closed vocabulary | that value wins, unconditionally |
| **existing** | no parsed value, but the issue already carries valid label(s) in the namespace | the existing value is preserved |
| **default** | neither | `medium` / `M` fills the empty namespace |

Applied as a **namespace-scoped replace**: `ensureLabel` + `addLabel` the winner, then
`removeLabel` every *other* label on the issue matching `^priority: ` / `^size: `. This
requires one new read (`GET .../issues/{n}/labels`) which the seam does not perform today.

**Existing-tier tiebreak when a namespace already holds more than one label:** if exactly
one member is non-default, it is the winner (the default is the intruder — true for all 23
live cases, and entailed by the mechanism, since the only value this automation can add
without a parse is the default). If two or more non-default members are present, the
correct value is **not inferable**; the seam leaves that namespace untouched and reports it
so a human resolves it. The sweep never guesses between two operator-plausible values.

### 2. `bin/intake-file` renders `### Priority` / `### Size` into the issue body

The CLI already knows the resolved value before it creates the issue. It appends the two
headings, in the exact shape `extractField` already parses, to the body it submits.

**The parser regex is not touched.** One parser, two producers — instead of teaching the
parser a second shape (which would put the issue-form path at risk for no gain). This makes
the fix's blast radius on the working path provably zero.

### The doc is corrected to match

The workflow header's "set labels REST endpoint (a full replace)" claim is replaced with an
accurate description of namespace-scoped replace + the authority ladder. A full replace is
explicitly rejected below.

## Alternatives considered

- **A true `PUT .../labels` full replace, as the header claims.** Rejected on two counts.
  (a) It is *destructive*: PUT replaces the entire label set, so it would strip
  `engineer:handled`, every `blocked_by:#N` edge label, and any hand-applied triage label
  the operator added. (b) It would not even fix #889 — the workflow's desired set is still
  the *defaults*, so a full replace would turn `size: S` + `size: M` into a single,
  confidently **wrong** `size: M`. Collapsing the contradiction is not the goal; preserving
  the operator's choice is. Authority must be settled before replace is safe.
- **Teach `extractField` the `## Observed` CLI body shape.** Rejected: the CLI body carries
  **no** priority or size information anywhere — `--size S` never appears in it — so there
  is nothing for a second regex to find. It would also widen the surface of the one
  component the issue-form path depends on.
- **Have the workflow skip any issue that already carries a valid `priority:`/`size:`
  label** (hypothesis 3 in #889). Rejected as the *whole* answer: it fixes the duplicate
  but silently disables the issue-form path's ability to update a label when the operator
  edits the form's Priority dropdown — a real regression. It survives as the **existing**
  tier of the ladder, correctly subordinated to **explicit**.
- **Serialize the CLI and the workflow (CLI waits for, or suppresses, the run).** Rejected:
  the workflow trigger is not suppressible per-issue without a marker label, adds ~20s of
  latency to every filing, and leaves the underlying additive-write bug in place for the
  form path. Convergence (both producers derive the same value) beats sequencing.

## Consequences

- The seam performs one extra `gh` read per sync. Acceptable: this runs at most once per
  issue open/edit and the whole path is already best-effort/non-fatal.
- `syncIssueLabels` becomes genuinely convergent, so the open/apply race between the CLI
  and the workflow can no longer produce a divergent result regardless of which lands last.
- The documented idempotency claim becomes true, and the acceptance test that asserts it
  becomes meaningful (it must be strengthened to use *differing* values — the case that
  currently passes falsely).
- The one-time cleanup of the 23 issues is the same seam invoked with no parsed fields, not
  a parallel script — so the sweep and the prevention cannot drift apart.
- `removeLabel` already exists in `pr-labels.ts` (`restRemoveLabelArgs`, URL-encoded) and is
  reused as-is; no new REST idiom is introduced.
