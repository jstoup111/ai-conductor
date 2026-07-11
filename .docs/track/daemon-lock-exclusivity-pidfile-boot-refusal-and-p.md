Track: technical

Rationale: A daemon-internal mutex hardening — no user-facing product surface. The
change is to the pidfile lock primitive (`daemon-lock.ts`) and the daemon boot/sweep
seams (`daemon-cli.ts`, `engine/daemon.ts`); acceptance is verified by process behavior
(exit codes, dispatch stop), not by end-user requirements.
