# Intake origin: pipeline-batch-evaluators-remain-an-unenforced-sec

Source-Ref: jstoup111/ai-conductor#3056
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3056 digest=fb82b1bc74a5fcffeaf8085202678296cf48b6fa4e77649c7c7839013f9a7023 >>>
## Desired outcome

- A `/pipeline` BUILD dispatches no batch evaluator and never blocks a batch boundary on an evaluator verdict, `review.json`, or `evaluator` closeout event.
- `build_review` is the single documented post-build review authority; no harness doc or skill claims an evaluator verdict satisfies a code-review gate.
- Per-batch-boundary `/simplify`, lint, and affected-test runs still happen.
- Model-routing tables and closeout-obligation vocabularies no longer advertise an evaluator role that never runs (or an explicit, documented reason remains for any that stay).
<<< END INBOUND >>>
