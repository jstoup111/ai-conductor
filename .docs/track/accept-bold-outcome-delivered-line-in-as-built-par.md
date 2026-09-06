# Track: Accept bold Outcome delivered line in as-built parser

Track: technical

Scope boundary: Small fix for #2175, approved by the operator on 2026-09-06 (delegated). The slice
covers the two as-built label lines `Verdict:` and `Outcome delivered:` and every engine reader of
them that a PLAN_GAP report passes through: the as-built completion gate's verdict reader and
outcome reader, and the shipped-record association that retains a delivered plan gap. One shared
line reader owns the accepted style set so the readers cannot drift apart again. Out of scope: the
heading form of the verdict line (owned by the sibling issue #2203), the duplicate bold-tolerant
BLOCKED detection regex in the conductor's halt-detail renderer, the closed verdict vocabulary
itself, the findings-table parser, and any change to what a PLAN_GAP is allowed to ship.

This is an engine parsing correction; acceptance criteria live in technical stories rather than a
product requirements document. The operator-facing behavior is unchanged apart from which
spellings of the two label lines are accepted.

Approach: mirror the verdict reader's existing marker tolerance for the outcome line by extracting
it into one shared reader, rather than copying a fourth regex. The filer's hypothesis was to widen
the outcome regex in place; that was weighed and rejected because it leaves four independent copies
of the same grammar, which is the condition that produced this defect. Extraction is the same size
of change and removes the drift surface. Approved by the operator on 2026-09-06 (delegated).

Scope check: A — consumer-facing (engine behavior; a repository with no daemon, no self-host build,
and no local artifact history still runs the as-built review gate and still benefits); B — n/a (no
new skill); C — provider-agnostic (no provider path, variable, or capability is involved). No
catalog registration and no behavioral-rule edit are required: this corrects engine parsing, it
does not narrow or replace a documented convention.

Verified foundation: the as-built verdict reader at `readAsBuiltVerdictLine` matches a line-anchored
pattern that tolerates up to two marker characters before the label, between the label and its
colon, and around the value, then strips marker characters from the captured value and trims it.
The outcome line inside `classifyAsBuiltReviewOutcome` uses a near-identical pattern that omits the
marker tolerance after the colon, so a bold-styled outcome value never matches and the report falls
through to the missing-outcome invalid cause. A third copy in the shipped-record association's
delivered-plan-gap projection is stricter still — it tolerates no markers at all on either label —
so a bold report that starts passing the gate would silently lose its recorded finding. A fourth
copy, verdict-only and already marker-tolerant, sits in the conductor's blocked-findings halt
renderer and is left to the sibling issue. The association module currently imports nothing, so the
shared reader belongs in its own focused module rather than in the artifacts module both would
otherwise have to depend on.
