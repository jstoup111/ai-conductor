# Intake origin: daemon-commits-carry-no-bot-co-authored-by-trailer

Source-Ref: jstoup111/ai-conductor#3377
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3377 digest=a81400096a15a96eb7c3cf6748fb5b8be1375726cecf06dba3dc5a596d8c24bc >>>
## Desired outcome

- Under the default `executor_isolation: child` with a valid bot token, every daemon-created commit on a feature branch carries `Co-authored-by: <bot-login> <{id}+{login}@users.noreply.github.com> (the GitHub noreply form)`.
- The same holds under `executor_isolation: in-process`.
- When the trailer can't be resolved for any reason, including the resolver being absent from the process making the commit, a `bot_co_author_skipped` event with a reason reaches the event spine and `daemon.log`.
- Negative path: with `github_bot` unconfigured, commits carry no bot trailer and no skip event, as today.
- Operator-run commits are still never stamped.
<<< END INBOUND >>>
