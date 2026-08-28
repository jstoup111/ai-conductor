# Intake origin: finish-deadlocks-when-the-prose-judge-asks-for-rev

Source-Ref: jstoup111/ai-conductor#2006
Owner: jstoup111

## Desired outcome

- A PR whose prose the judge marks as needing revision gets an authoring pass and a
  re-judgment automatically, without operator intervention.
- A judge verdict that does not converge still terminates: repeated author-then-judge laps
  stop at the existing bounded publication-progress allowance and halt, rather than looping.
- When FINISH does halt on prose, the halt states the judge's concrete objection where the
  verdict carried one, instead of only naming a transition mismatch.
- The non-advancing-transition guard still halts for the case it was built for — a transition
  that genuinely leaves the state it owns unchanged.
- Re-dispatching FINISH on `remove-retrospectives-full-and-micro-from-feature-` either
  publishes or produces a different, substantive halt — never a repeat of this message.
