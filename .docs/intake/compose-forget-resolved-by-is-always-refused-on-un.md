# Intake origin: compose-forget-resolved-by-is-always-refused-on-un

Source-Ref: jstoup111/ai-conductor#2786
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2786 digest=158d76a9f574745fb7a4815b302bb11a962d67e21707bf08b85e5167d1bde620 >>>
## Desired outcome

- For an intake issue with no assignees, the §3a drop can record the resolving reference and close the issue through the composer primitive once the operator explicitly approves that close. No manual `gh` step is needed.
- When the drop cannot be authorized, the refusal names the actual reason (for example, not the sole assignee and no approval route available). It does not stop at a bare `explicit-authorization-required`.
- The guard's intent is preserved: an agent without operator approval still cannot comment on or close an issue it does not own.
- The composer skill's §3a instructions match what the primitive can actually do.
<<< END INBOUND >>>
