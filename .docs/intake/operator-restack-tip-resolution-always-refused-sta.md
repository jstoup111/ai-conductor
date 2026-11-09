# Intake origin: operator-restack-tip-resolution-always-refused-sta

Source-Ref: jstoup111/ai-conductor#3582
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3582 digest=6c78c015ec18957faab949fd1cb95337c3c7e28b00b17f805bd2dd27d97e7900 >>>
## Desired outcome

- An operator `--tip` resolution recorded against the parent the halt named is consumed on the next dispatch. Halt bookkeeping that changes no feature content does not cause a `restack-resolution-stale` refusal.
- A resolution that is genuinely stale (the parent's feature content changed) is still refused.
- After a `restack-resolution-stale` halt, the operator has a documented path (re-resolve, `--decision`, or a fresh conflict record) that needs no manual `git update-ref -d` on `refs/conductor/...`.
<<< END INBOUND >>>
