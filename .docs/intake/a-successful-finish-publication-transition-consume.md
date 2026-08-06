# Intake origin: a-successful-finish-publication-transition-consume

Source-Ref: jstoup111/ai-conductor#1342
Owner: jstoup111

## Desired outcome

- A publication transition that succeeds does not consume `finish`'s retry budget.
- `finish`'s retry budget is spent only on genuine failures, and a full-budget allowance remains available to absorb a real transient after any number of successful transitions.
- A publication state machine that stops advancing still terminates — the change must not convert budget exhaustion into an unbounded loop. A run that repeats a transition without making progress (as `establish_pr` did above) is bounded and halts with a reason naming the stuck transition.
- A fully-successful publication reports no retry consumption in the daemon log — no `↻ finish retry` line follows a `✓` transition.
- Regression coverage pins a 5-transition successful publication completing with its retry budget intact.
