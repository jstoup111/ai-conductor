# Intake origin: streaming-provider-dispatches-record-no-token-usag

Source-Ref: jstoup111/ai-conductor#1857
Owner: jstoup111

## Desired outcome

- A completed feature's reported cost and token totals account for every dispatch that actually ran,
  regardless of which dispatch path the step used.
- A dispatch whose usage genuinely cannot be measured is visibly reported as unmeasured, and is
  never silently folded into a figure presented as a total.
- Token totals and cost totals in the same reported line are derived from the same set of
  dispatches, or the line states that they are not.
- Steps that already report usage keep reporting it unchanged, and no dispatch acquires a
  fabricated or estimated cost as a side effect.
