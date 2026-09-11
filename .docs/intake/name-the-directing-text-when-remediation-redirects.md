# Intake origin: name-the-directing-text-when-remediation-redirects

Source-Ref: jstoup111/ai-conductor#1851
Owner: jstoup111

## Desired outcome
- A remediation task that only cites a protected artifact as evidence stays on its
  authored disposition; the feature proceeds without operator intervention.
- A remediation task that would genuinely edit another feature's sealed artifact is
  still redirected away from `build`, as it is today.
- Task titles and rationale prose are judged by the same standard — a mention is not an
  edit in either.
- When a redirect does fire, the halt names the text that was read as directing the
  edit, so an operator can tell a true positive from a false one without reading engine
  source.
