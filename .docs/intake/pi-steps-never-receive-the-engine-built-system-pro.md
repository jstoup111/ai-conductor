# Intake origin: pi-steps-never-receive-the-engine-built-system-pro

Source-Ref: jstoup111/ai-conductor#3309
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3309 digest=98473850da9614cda88b24f39e7b1569f70221ba34adac7da816db59bc1f5208 >>>
## Desired outcome

- A step dispatched to Pi receives the same engine-built system-prompt content that Claude and Codex receive for that step. That includes a RETRY reason, and the full build_review remediate adjudication context.
- A system prompt larger than 128 KiB reaches Pi without failing the spawn (`E2BIG`).
- If a provider cannot deliver a step's system prompt, the dispatch fails with a named, operator-readable reason instead of running without it.
- Claude and Codex delivery stays the same.
<<< END INBOUND >>>
