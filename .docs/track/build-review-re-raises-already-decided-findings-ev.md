# Track: build_review re-raises already-decided findings every lap and never converges

Track: technical

Scope boundary: Balanced. Approach A, lap-monotonic review scope. Each build_review lap persists the
feature-diff hunks it reviewed, identified by path and the `+`/`-`-only hunk content hash, in its
existing lap artifact. A hunk is settled once a lap at the current merge base reviewed it and every
finding on it was non-blocking or has a finalized source. After the first lap, every rubric, built-in
and custom, judges only the delta: hunks that are not settled. A hunk with an unfinalized finding is
never settled, so it is judged again. Rubrics receive no case history. The full diff is supplied as
reference context only. The engine enforces the delta; this is not a prompt rule. A later-lap finding
anchored in a settled hunk blocks only when it names a cause hunk that the engine verifies is in this
lap's delta. Otherwise it is recorded as out-of-delta, an advisory class that neither kicks back nor
charges. A finding the reviewer rates `critical` is never out-of-delta and always blocks. Any change of merge base since the prior reviewed lap forces one full-diff lap, whatever the
rebase cause. The testQuality counterfactual preflight stays whole-diff. A convergence bound sits on
top of #3124: a finding in a hunk that a repair for case X introduced joins X's recurrence lineage,
derived by the engine from the lap interval and path rather than finding ids, so chained repair-introduced
defects share #3124's limit. The remediate judge also receives prior findings' summaries and evidence
locations, not only opaque source ids. Genuinely new defects, including repair-introduced ones, still
kick back. Excluded: #1783 and #1627 (lap cost reduction is a side effect only), changing
finding-identity hashing, a configurable lap cap, and the prd_audit and as-built gates (#2440, #3126,
#3127).

Internal engine invariant and reviewer/judge contract change with no user-facing product capability;
acceptance criteria live in stories. Source: intake jstoup111/ai-conductor#3294.
