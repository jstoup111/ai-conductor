# Intake origin: manual-test-failure-routed-to-a-child-that-can-t-h

Source-Ref: jstoup111/ai-conductor#3605
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3605 digest=c4198e2cae9d7f9352cb6f0c51a98f6abe486c2e73361230b03196abcdebf45d >>>
## Desired outcome

- A routed finding is placed on a stack child that contains (or owns the task for) the code it names. A UI finding about controls added by child N doesn't land on a child below N.
- When an audit round's only host has no dispatchable work, the operator has a supported, recorded command to close or supersede the round. Afterwards they can commit the fix on the leaf (or another chosen child) and resume, without editing refs by hand.
- The stack-commit-guard's refusal message only suggests recovery commands that apply to the current round kind.
- Negative path: an audit round whose host does have dispatchable work still can't be closed out from under it without the same explicit operator reason.
<<< END INBOUND >>>
