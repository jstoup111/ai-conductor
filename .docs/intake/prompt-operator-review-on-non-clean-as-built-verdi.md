# Intake origin: prompt-operator-review-on-non-clean-as-built-verdi

Source-Ref: jstoup111/ai-conductor#2698
Owner: jstoup111

## Desired outcome
- An operator decision records whether a non-clean as-built verdict (`APPROVED WITH DRIFT NOTES`, `PLAN_GAP`, `BLOCKED`) prompts for review in a non-auto run.
- If prompting is chosen: in a non-auto run with the step's review mode `conditional`, a non-clean as-built verdict prompts the operator, and a clean `APPROVED` verdict does not.
- In auto/daemon mode, as-built behavior is unchanged whichever way the decision goes.
