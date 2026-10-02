# Intake origin: engine-prompts-direct-daemon-sessions-to-ai-conduc

Source-Ref: jstoup111/ai-conductor#2709
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2709 digest=04dfecec88c33d8ed3303cc348598d898b0a5bc7fa6b1dfcf787c91dfdae59e2 >>>
## Desired outcome

- A change that makes an engine-rendered daemon-session prompt, or a skill that daemon sessions follow, instruct an `ai-conductor <subcommand>` the session guard blocks fails a check before merge. The failure names the prompt location and the subcommand.
- A subcommand deliberately blocked in daemon sessions (for example `test-suite`, or `build-review` operator verbs) can still appear in interactive-only instructions without failing that check.
- When the session guard refuses a subcommand during a daemon run, the refusal appears on the event spine and in the daemon log with the feature slug and subcommand. It is not visible only in the provider transcript.
- A daemon session that performs a GitHub write the guarded path should own (such as raw `gh pr edit` on the feature PR) is observable to the operator, not silent.
<<< END INBOUND >>>
