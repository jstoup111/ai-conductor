# Intake origin: coverage-binding-lap-cap-halt-has-no-supported-rec

Source-Ref: jstoup111/ai-conductor#2846
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2846 digest=d4cb8d98e216403bbf9998e18714ee866ec7e4b938bf4298fec21c18f7fe5ef7 >>>
## Desired outcome

- An operator can grant additional coverage_binding remediation laps to a halted feature through the same supported CLI used for the other remediation gates, with a rationale recorded in adjustment history.
- After such a grant, the next dispatch reopens the bound tasks instead of re-halting on the lap cap.
- `kickback-budget inspect` shows coverage_binding's consumed laps, cap, and adjustments alongside the other gates.
- Invalid requests (unknown gate, empty rationale) are still refused.
<<< END INBOUND >>>
