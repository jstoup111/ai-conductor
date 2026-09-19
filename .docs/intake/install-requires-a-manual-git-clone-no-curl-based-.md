# Intake origin: install-requires-a-manual-git-clone-no-curl-based-

Source-Ref: jstoup111/ai-conductor#1712
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#1712 digest=bb4c7f0cb0ec47d0fa9bf61dd38d4cdde1f98785693e7b936cb98a5b72561b0c >>>
## Desired outcome

- A consumer on a fresh machine installs the harness with a single `curl ... | sh` command, without manually cloning first; the installer acquires the harness itself (to a canonical location), on the channel resolved per #1711's rules, and runs the existing install flow.
- The one-liner works without SSH credentials (public HTTPS acquisition), while an existing manually-cloned checkout keeps working exactly as today.
- Re-running the one-liner on an installed machine behaves as an update/no-op, not a second install.
- The command and its channel/flag options are documented as the primary install path.
<<< END INBOUND >>>
