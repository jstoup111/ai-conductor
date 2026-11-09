# Track: Done step with an unsatisfied gate verdict loops silently to the selection cap

Track: technical

Scope boundary: Outcomes of jstoup111/ai-conductor#3487. When a step completes successfully but its
unsatisfied gate verdict was not refreshed by that dispatch, the engine re-derives the verdict from an
authoritative source where re-derivation is side-effect-free (a `noop` or `mergeable_skip` rebase,
via the existing rebase verdict writer) and continues; otherwise (a `changed` rebase, or any other
step that writes its own verdict) it halts immediately, naming the step, stating that it completed
without refreshing its verdict, and quoting the stale reason. A re-derived verdict that is still
unsatisfied, a genuinely re-failing gate, and kickback flows keep today's selection-cap behavior and
halt wording. Excluded: changing any rebase outcome's verdict semantics (owned by #3479/#3488),
re-applying a `changed` rebase's downstream invalidations, and the artifact-recomputed gate steps,
which already refresh their verdict after every run.

Operator-confirmed 2026-10-29: Approach A (heal at completion, halt only when healing is unsafe),
chosen over a selection-time freshness halt (never heals) and a bounded single retry (deterministic
gap makes the retry waste). Internal engine loop behavior with no product requirements.
