# Intake origin: halt-records-never-reach-origin-after-daemon-auto-

Source-Ref: jstoup111/ai-conductor#2891
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2891 digest=39cea90d24f38c75b5f79abdcd1689f23bfc261c5c2cff080270c80d596b42c8 >>>
## Desired outcome

- After a daemon rebase, a halt record written for the feature appears on `origin/feat/daemon-<slug>` with no `halt_record_push_failed` event.
- A halt resolution (supersede) written after a rebase also reaches origin.
- If someone other than the daemon really did move the remote branch, the daemon does not overwrite it silently. The failure is still reported.
<<< END INBOUND >>>
