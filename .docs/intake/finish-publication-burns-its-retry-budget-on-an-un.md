# Intake origin: finish-publication-burns-its-retry-budget-on-an-un

Source-Ref: jstoup111/ai-conductor#1487
Owner: jstoup111

## Desired outcome

- A retry that cannot advance is never issued: a publication retry either performs the transition it names, or resolves as human-required — never re-runs a stage that will return the identical verdict.
- A PR whose body carries the halt-boilerplate marker resolves as human-required at FINISH, without consuming retry attempts.
- The halt reason an operator sees names the stage that actually ran and why it could not advance, sufficient to act on without reading engine source.
- Verdicts and observations that disagree about a PR's prose state are surfaced as a defect rather than silently converted into a retry.
- Publication paths that legitimately converge — author, judge, accept — keep working with no extra attempts.
