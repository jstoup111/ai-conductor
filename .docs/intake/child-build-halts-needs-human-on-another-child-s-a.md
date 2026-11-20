# Intake origin: child-build-halts-needs-human-on-another-child-s-a

Source-Ref: jstoup111/ai-conductor#3658
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3658 digest=dbadfd7eb76043df22bf140a212576d80a52c88a6f72ff915aa7b252de0b0dd6 >>>
## Desired outcome

- A BUILD for child N never sees or acts on a remediation case, work order, or plan that belongs to another child or is already settled.
- A stall caused only by settled or foreign remediation state doesn't escalate to needs-human. It resolves automatically, or at worst halts as mechanical with a supported clear path.
- If such a HALT still happens, the operator has a supported command that clears it. That command doesn't refuse with "already resolved" and leave the HALT in place.
- Negative path: an open, owned case for the active child still reaches that child's BUILD as before.
<<< END INBOUND >>>
