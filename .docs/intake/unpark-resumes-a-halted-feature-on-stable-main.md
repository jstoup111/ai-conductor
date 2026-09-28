# Intake origin: unpark-resumes-a-halted-feature-on-stable-main

Source-Ref: jstoup111/ai-conductor#822
Owner: jstoup111

## Desired outcome

- Unparking a halted feature causes the daemon to re-dispatch/resume it within one poll cycle
- A halted, unparked feature is **never** left indefinitely un-dispatched while `main` is
- No manual editing of `.daemon/last-base-sha` and no unrelated merge is required to resume a
- Existing invariants still hold, verifiable independently: an **operator-parked** halted
