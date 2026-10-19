# Track: build_review halts when a judgement re-raises a source a resolved case owns

Track: technical

Scope boundary: Balanced. The build_review case store refuses a source only when two open cases
link it. Every build_review source-to-case reader takes a source's most recent link as
authoritative. An unbound re-raise of a source that only resolved cases own is admitted as a new
case, and a new act case is charged against the kickback cap (this amends adr-2026-08-29 D7 for
unbound re-raises). Every rejected case-store transition halt names its invariant, case ids and
source ids, including the decision-stop path. A replayed decision stop converges on its own open
stop instead of failing `conflicting-case-id`. This spec also delivers the core outcome of #2464
(a new concern at a resolved anchor gets its own case; at most one unresolved case per source).
Excluded: `distinctFrom` declarations and recurrence-keeps-limits semantics (#3124 becomes an
optional tightening; the kickback cap is the bound); explicit `existingCaseId` rebinds to resolved
cases, which keep the D7 regression halt; supersession of an OPEN owner by a decision or
consistency stop (#3005's D9.x items); operator-acceptance carry-over (#3271, which lands first and owns it);
hand-off provenance fields and any store schema change; prd_widening cases.

Internal engine invariant and adjudication-routing fix with no user-facing product capability;
acceptance criteria live in stories. Source: intake jstoup111/ai-conductor#3292.
