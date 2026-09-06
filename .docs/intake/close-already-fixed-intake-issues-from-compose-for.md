# Intake origin: close-already-fixed-intake-issues-from-compose-for

Source-Ref: jstoup111/ai-conductor#830
Owner: jstoup111

## Desired outcome
- When the engineer resolves a claimed intake idea as **already fixed**, and the operator approves the disposition, the originating issue is **closed automatically** — no manual GitHub step remains.
- The auto-close leaves a **comment on the issue naming what resolved it** (e.g. the resolving PR / commit), so the closure is auditable, not silent.
- The close is **gated on explicit operator approval** and only acts when the idea carries a `sourceRef` (a GitHub-originated intake) — a CLI/chat idea with no originating issue closes nothing.
- An idea dropped for a **different** reason (no-fit, operator declines, still-live bug) does **not** close any issue — only the "already fixed / resolved elsewhere" disposition does.
- After the drop, the GitHub issue state and the intake ledger **agree** (both reflect the issue as resolved), instead of the issue staying open while the ledger reads `done`.
