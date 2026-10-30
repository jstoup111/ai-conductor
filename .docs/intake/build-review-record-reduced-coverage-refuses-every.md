# Intake origin: build-review-record-reduced-coverage-refuses-every

Source-Ref: jstoup111/ai-conductor#3498
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3498 digest=48e2284630d35ba5f43f8800ee2c44c9ec5e00b2ef1d85ab549c2833d75fa23d >>>
## Desired outcome

- On a stacked feature, an operator can record a reduced-coverage decision for a specific child's current lap and rubric. That child's next `build_review` pass then treats the rubric's coverage as reduced.
- The allowance precondition is judged against the same mechanical-fault count the child's halt reported.
- The exhausted-allowance halt for a child names a recovery command that works for that child as printed.
- When the command refuses, it names the artifact it could not read or validate, and the reason.
- Flat (non-stacked) features keep their current behavior.
<<< END INBOUND >>>
