# Intake origin: self-host-builds-isolate-and-fingerprint-pi-operat

Source-Ref: jstoup111/ai-conductor#1887
Owner: jstoup111

## Desired outcome

- A self-host build dispatched through Pi runs against an isolated Pi home; the operator's live `~/.pi/agent/` state (auth.json especially) is never read or written by the build.
- Pi's routine state churn (sessions, caches, history) during a run does not halt the live boundary, while a genuine self-host write to Pi operator config still does.
- Interrupted Pi self-host runs do not leak isolated Pi homes (parity with the existing leak-sweep behavior).
- An operator edit to Pi config while a proven-contained dispatch runs behaves the same as for claude/codex today.
