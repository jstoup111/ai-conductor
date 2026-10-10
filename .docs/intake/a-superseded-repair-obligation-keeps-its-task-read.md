# Intake origin: a-superseded-repair-obligation-keeps-its-task-read

Source-Ref: jstoup111/ai-conductor#2598
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2598 digest=4d5397113b9301866ac4684b9b3615fb9ab1fd7af1a91fa822e668f30569db39 >>>
## Desired outcome

- A task whose current repair obligation is resolved reads as complete even when an older, superseded obligation for the same task is still open.
- A task whose current obligation is open still reads as open.
- A task that has obligations but no recorded current obligation does not silently read as complete; the engine's behaviour in that state is defined and visible.
- Squashed or rebased lineage does not change which obligation counts as current.
<<< END INBOUND >>>
