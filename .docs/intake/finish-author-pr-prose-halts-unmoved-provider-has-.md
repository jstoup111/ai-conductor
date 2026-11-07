# Intake origin: finish-author-pr-prose-halts-unmoved-provider-has-

Source-Ref: jstoup111/ai-conductor#3529
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3529 digest=5a0b96a59521d90858c0ff0af672c219af4190128a4fe0b1159342bf7e6ead4d >>>
## Desired outcome

- When the provider has authored valid PR prose, `author_pr_prose` advances `pr.prose` past placeholder without any operator action.
- A provider never has to discover or hand-build a GitHub request shape to publish PR prose.
- `skills/finish` and `skills/pr` give one consistent account of who performs the PR title/body write.
- When the provider fails to author prose, FINISH reports that failure specifically, not just "transition unmoved".
- (Secondary) A daemon session that runs `ai-conductor --help` or omits the subcommand gets a refusal that does not suggest sanctioned subcommands are blocked.
<<< END INBOUND >>>
