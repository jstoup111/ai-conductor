# Track: Running provider is invisible per step, and absent for parallel members

Track: product

Scope boundary: Balanced — the daemon log (`daemon-cli.ts` renderDaemonEvent) and the interactive terminal renderer (`ui/terminal-renderer.ts`) show the executing provider at every attempt start, for serial steps and each parallel group member, reflecting mid-step fallback and stating "provider unknown" when unresolvable. Excluded: the `conduct daemon status` dashboard, cost/usage reporting, and any change to provider routing or fallback behavior.

Operator-visible live display behavior with explicit requirements (fallback correctness, unknown state, no extra noise on single-provider serial runs) — warrants a PRD.
