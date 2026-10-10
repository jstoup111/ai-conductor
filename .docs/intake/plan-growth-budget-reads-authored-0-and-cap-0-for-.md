# Intake origin: plan-growth-budget-reads-authored-0-and-cap-0-for-

Source-Ref: jstoup111/ai-conductor#2822
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2822 digest=aa9428e626ed71232b092c77c195606edc6358b507280b6aefbf2a6c36de467f >>>
## Desired outcome

- `daemon status` and `kickback-budget inspect` report the same growth cap, and the same remaining count, that the engine enforces at the next remediation append.
- For a daemon-dispatched feature with N authored plan tasks and no appends, the reported authored count is N, not 0.
- Appended remediation tasks count as added, not as authored, in both the reported numbers and the enforced cap.
- A feature whose plan genuinely cannot be resolved is reported as unresolved, not as a cap of 0.
<<< END INBOUND >>>
