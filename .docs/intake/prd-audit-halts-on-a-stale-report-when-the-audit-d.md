# Intake origin: prd-audit-halts-on-a-stale-report-when-the-audit-d

Source-Ref: jstoup111/ai-conductor#1838
Owner: jstoup111

## Desired outcome

- A gate that reads a persisted verdict artifact cannot act on one produced by an earlier lap than the run being judged.
- When the artifact a gate needs is missing or older than the run that should have written it, the gate says so — naming the artifact and both timestamps — instead of reporting the stale verdict's findings as current.
- A completed audit either writes its report and marker or fails visibly; silently settling without producing them is not a success.
- Clearing the resulting halt does not require an operator to know which `.pipeline/` files to delete by hand.
