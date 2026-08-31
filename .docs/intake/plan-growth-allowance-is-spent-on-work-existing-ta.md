# Intake origin: plan-growth-allowance-is-spent-on-work-existing-ta

Source-Ref: jstoup111/ai-conductor#2119
Owner: jstoup111

## Desired outcome

- A finding whose remedy is owned by an existing plan task does not consume plan-growth
  allowance, and does not halt a feature whose allowance is unspent.
- Such a finding is still bounded — it cannot re-route indefinitely — and the budget it does
  consume is visible to an operator by name.
- A finding that genuinely needs new plan tasks still consumes growth allowance exactly as
  today, and still halts when that allowance is truly exhausted.
- A halt on an unspent allowance, if it can still occur, states which budget was actually
  exhausted rather than reporting a growth cap that nothing had drawn against.
- An operator can tell from the halt whether the plan needed to grow or whether already-planned
  work was merely unfinished.
