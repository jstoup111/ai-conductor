# Intake origin: daemon-commits-co-authored-by-the-configured-bot

Source-Ref: jstoup111/ai-conductor#2722
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2722 digest=20211a0364fde6956922f2291a4841ed5fd273d1552391b06ceda5e8e3c33593 >>>
## Desired outcome

- With a bot configured, every commit the daemon creates shows both the operator and the bot as authors in GitHub's commit view, with the bot's avatar linked to the bot account. This must survive the PR squash-merge.
- With no bot configured, daemon commits are byte-for-byte unchanged from today.
- Commits the operator makes by hand outside the daemon are unaffected.
- The bot token never appears in any commit message or log.
<<< END INBOUND >>>
