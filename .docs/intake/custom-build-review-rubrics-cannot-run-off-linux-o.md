# Intake origin: custom-build-review-rubrics-cannot-run-off-linux-o

Source-Ref: jstoup111/ai-conductor#2735
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2735 digest=0fe70b555c3b54ccab58a2114ec813ee6d28772928502cd770a357a520c628a5 >>>
## Desired outcome

- A custom rubric runs and produces a verdict on macOS, on Linux with Ubuntu's default AppArmor userns restriction, and on Linux with unrestricted bwrap.
- Wherever it runs, the reviewer cannot change the frozen source, baseline, installed policy, or engine evidence: writes are blocked by the provider's read-only review mode, and any change that still occurs is detected and the verdict discarded. Reads are restricted by the provider's tool set, not proven by an OS boundary.
- On a platform where no read-only boundary can be proven, enabling a custom rubric is reported up front (config load / status) with the platform named, rather than halting a feature after three review faults.
- Built-in rubrics and non-review steps behave as today on every platform.
<<< END INBOUND >>>
