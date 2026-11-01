# Intake origin: routed-repair-hosts-a-finding-on-a-stack-child-tha

Source-Ref: jstoup111/ai-conductor#3550
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3550 digest=29607d557384c0c8ff28a6598254d30a3572bdce03ad7aeb5389215bcb0f03bb >>>
## Desired outcome

- A routed-repair task is never hosted on a stack child whose tree lacks a file the task must modify.
- When one finding spans slices, each part runs on a child where its target files exist, or the round refuses at admission with a halt that names the finding, the intended host, and the missing paths.
- A prerequisite-path check never passes just because a directory exists when the task names a specific file.
- Findings whose targets all exist in the chosen host still route to it as today.
<<< END INBOUND >>>
