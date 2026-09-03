# ADR: Cited plan-task references resolve through one shared resolver, not per-consumer parses

**Date:** 2026-08-30
**Status:** APPROVED
**Deciders:** operator (jstoup111), composer session for #2064

## Context

`remediation-append.ts` deliberately emits non-numeric plan-task ids (`rem-<gate>-<gapId>`, H9
grammar `[A-Za-z0-9._-]+`, guaranteed never purely numeric so `expandTaskIds` range expansion
cannot mangle them). The grammar authority is already centralized: `plan-task-parse.ts` exports
`TASK_ID_PATTERN`, and `remediation-append.ts` pins to it.

But `artifacts.ts`'s prd_audit Verdict Table consumer re-invented its own narrower parse:
`Number(rawPlanTask)` rejects any non-integer (`artifacts.ts:4417-4423`). The moment the engine
appends a remediation task, citing it correctly becomes a mechanical-halt deadlock — the report
regenerates identically on every re-dispatch (observed on
`test-suite-re-runs-and-re-passes-the-full-suite-10`, issue #2064). This is the second
consumer-too-narrow parse defect in a week; #2054 is the ADR-decision-shape equivalent.

## Decision

1. **One resolver seam.** A shared engine function (living beside `plan-task-parse.ts`'s grammar
   authority) resolves a cited reference against the artifact that defines it: strip tolerated
   trailing annotation, validate the H9 grammar, check membership in the artifact's actual id
   set, and return either the resolved id or a diagnostic naming the citing key and the
   unresolvable reference. Consumers MUST NOT re-derive id validity with their own
   `Number()`/regex parses.
2. **prd_audit adopts it now.** The Verdict Table `Plan task` cell accepts any id present in the
   active plan (integer or `rem-…`); `planTask` is carried as a string id downstream. A citation
   naming an id absent from the plan is still rejected, with a diagnostic naming the criterion
   and the id.
3. **Tolerated annotation is stripped, not rejected.** A trailing parenthesized annotation (e.g.
   `(landed)`) on the cited id resolves to the bare id. Anything else non-conforming rejects
   with the diagnostic.
4. **Producer unchanged.** The `rem-` id scheme and its never-purely-numeric guarantee stand.
5. **#2054's consumer is a designed future adopter.** The resolver's contract (reference +
   artifact id set → resolved id | diagnostic) is artifact-agnostic; adopting it for ADR
   decision-heading resolution stays in #2054's lane and is out of scope here.

## Options Considered

- **Widen the consumer in place** — fixes only this instance; third independent narrow parse,
  the class recurs. Rejected.
- **Producer emits integers** — breaks the deliberate non-numeric guarantee protecting ids from
  numeric range expansion. Rejected.
- **Shared resolver (chosen)** — matches the single-parser precedents
  (adr-2026-08-08-single-adr-approval-parser-three-rungs,
  adr-2026-08-26-shared-coherence-parser-at-discovery): one grammar authority, multiple rungs,
  bespoke predicates deleted.

## Amendment

**Amended by:** hotfix for the prd-audit multi-task citation (2026-09-02, operator-authorized) —
D1 and D2 are **widened, not reversed**: a citation may name more than one task.

D1's contract said "reference + artifact id set -> resolved id", singular, and D2 carried
`planTask` downstream as one string. A criterion's evidence legitimately spans several plan tasks,
so the single-id form made the honest citation unrepresentable: the auditor either wrote the truth
and had its row rejected as `malformed`, or narrowed the citation to fit the parser. Observed on
`bin-setup-quarantines-a-fix-session-s-repair-inste`, where four **PASS** rows citing `12, 13`,
`1, 2, 14`, `13, 15` and `1, 2, 14` were discarded and the feature halted `needs-human` with a
message that read like audit findings. Nothing had failed the audit.

The resolver now returns `ids: string[]`. Every segment must satisfy the same grammar; one bad
segment rejects the whole citation rather than resolving the good half; an empty segment is
malformed rather than dropped; a repeated id collapses. Absent ids are all reported, not just the
first.

D1's substance is untouched — one grammar authority, membership checked against the citing
artifact's own plan, consumers still forbidden from re-deriving id validity. D3 (tolerated trailing
annotation) applies per segment. D4 and D5 are unaffected.

**A FIXABLE row still cites exactly one task.** Its repair is appended under a single parent
(`parentTask`), so the parser may not choose among several on the auditor's behalf; a multi-task
FIXABLE citation is rejected with a diagnostic naming the choice. The widening applies to rows whose
citation is evidence, not ownership.

## Consequences

- land-accepted plan ids are citable by construction; appending a remediation task can never
  make a previously-parseable report unparseable.
- Rejection diagnostics name the criterion and the unresolvable id instead of "invalid Plan
  task".
- The hand-renumbered tasks 23-27 on `test-suite-re-runs-and-re-passes-the-full-suite-10` need
  not stay renumbered once this lands.

## Evidence

- `src/conductor/src/engine/remediation-append.ts:11-15` — producer guarantee (verified, read).
- `src/conductor/src/engine/artifacts.ts:4417-4423` — `Number()` rejection (verified, read).
- `src/conductor/src/engine/plan-task-parse.ts` `TASK_ID_PATTERN` — existing grammar authority
  (verified via autoheal.ts import).
- Live halt on `test-suite-re-runs-and-re-passes-the-full-suite-10` per #2064 (filer-verified).
