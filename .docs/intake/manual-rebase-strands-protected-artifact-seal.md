# Intake origin: manual-rebase-strands-protected-artifact-seal

Source-Ref: jstoup111/ai-conductor#1229
Owner: jstoup111

## Desired outcome

- After any supported rebase workflow completes, the feature's protected-artifact seal is valid against the resulting HEAD without manual JSON edits or operator resealing.
- A protected artifact added only by the base branch is never reported as feature-authored.
- Recovery preserves genuine protected-artifact violations: an actual feature-authored BUILD/SHIP edit still halts.
- Daemon triage distinguishes a stranded post-rebase seal from a genuine feature-authored protected-artifact change and reports the evidence behind that classification.
- The reproduced sequence—rebase completion, base-only protected artifact advancement, and daemon resume—continues without manual intervention.
