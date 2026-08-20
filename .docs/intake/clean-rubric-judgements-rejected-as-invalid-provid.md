# Intake origin: clean-rubric-judgements-rejected-as-invalid-provid

Source-Ref: jstoup111/ai-conductor#1683
Owner: jstoup111

## Desired outcome

- A rubric judgement that is otherwise valid is accepted without depending on the
  provider to echo back identity values the coordinator already holds — or the provider
  supplies them reliably enough that clean judgements are not discarded.
- The staleness protection those identity fields exist for is preserved: a judgement
  produced against a different lap or snapshot is still rejected.
- When a provider result is rejected, the recorded failure names which requirement
  failed — parse, findings mismatch, rubric, lap, or snapshot — rather than one opaque
  code covering all five.
- The same rubric returns a consistent envelope shape across repeated attempts.
