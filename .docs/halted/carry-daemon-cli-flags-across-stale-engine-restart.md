# Halt record

Status: halted
Slug: carry-daemon-cli-flags-across-stale-engine-restart
Class: needs-human
Halting step: prd_audit
Phase: SHIP
Branch: feat/daemon-carry-daemon-cli-flags-across-stale-engine-restart
Head SHA: c2555cfdca7606234aa93467b4560c8409937554
Halted at: 2026-09-29T13:27:31.209Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Validation group "prd_audit" halted: as-built review verdict is BLOCKED and needs a human decision — Blocking findings: ADR-D7-MAX-IDLE-REPLAY (DESIGN; adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting decision 7): Verified at 98% confidence: the stale-engine respawn replays --max-idle-polls into the tmux-hosted successor, contradicting Decision 7’s binding long-lived/no-idle-self-limit foreground-command contract.

Blocking findings:
ADR-D7-MAX-IDLE-REPLAY (DESIGN; adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting decision 7): Verified at 98% confidence: the stale-engine respawn replays --max-idle-polls into the tmux-hosted successor, contradicting Decision 7’s binding long-lived/no-idle-self-limit foreground-command contract.
```
