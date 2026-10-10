# Intake origin: dead-src-conductor-bin-directory-lingers-after-int

Source-Ref: jstoup111/ai-conductor#2791
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2791 digest=6b27b60cdabd2948653f639fabaa7955990f5ed913268cddafd98b68e0bbda9a >>>
## Desired outcome

- The repository contains no `src/conductor/bin/` directory, and no file, doc, or test references it.
- Intake filing through the intake skill's bundled helper behaves exactly as it did before the removal.
- The aggregate test suite and the harness integrity suite pass with the directory gone.
<<< END INBOUND >>>
