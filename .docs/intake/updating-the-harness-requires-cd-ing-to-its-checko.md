# Intake origin: updating-the-harness-requires-cd-ing-to-its-checko

Source-Ref: jstoup111/ai-conductor#2605
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2605 digest=eb8c69b55ae32441cba3b1e9f3f605673d1d3b6ce81f284028215abc9b4393eb >>>
## Desired outcome

- From any working directory, one command on the installed CLI performs the same attended update that running `bin/update` inside the checkout performs today, including its confirmation prompts and exit status.
- The channel can be changed from any working directory the same way.
- It updates the harness checkout the invoked CLI actually belongs to, whether hand-cloned or bootstrap-installed.
- The command appears in `ai-conductor --help`, and `docs/quickstart.md` shows it as the update path.
- Negative path: when the updater cannot be found or the harness is not a git checkout, the command exits non-zero with a message naming the path it looked at; nothing is modified.
- Running `bin/update` directly keeps working unchanged, as does the startup `--auto` check.
<<< END INBOUND >>>
