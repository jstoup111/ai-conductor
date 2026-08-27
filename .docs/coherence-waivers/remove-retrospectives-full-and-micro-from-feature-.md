# Coherence Waiver: Remove retrospectives (full and micro) from feature delivery

Waives: criterion:disposition-negative:21, criterion:disposition-negative:22, criterion:disposition-negative:23

Rationale: The three Story 6 criteria are inherently outside-diff: their subject is GitHub
issue state (#717 closed, #939 re-scoped, the 927 residual story's disposition recorded in the
#939 comment), mutated by `gh` operations at finish (plan task 15), not by any commit in this
feature's diff. No commit outside the diff can be prevented from changing issue state, so a
diff-local disposition would be false. Operator-approved as part of the #1905 full-purge scope;
outcome-6 explicitly requires this external reconciliation.
