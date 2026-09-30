# Complexity: Carry daemon CLI flags across stale-engine restart

Tier: S

Operator scope: small, labeled `size: S` on #2366 and confirmed 2026-09-28 (delegated).

The change is bounded to two production files: the daemon argv parser gains a captured list of the operator's run-flag tokens, and the index.ts self-restart closure appends those tokens, shell-quoted, to the resolved foreground command. It reuses the existing parser, `shellQuote`, the exit-witness wrapper, and `respawnPane`. It introduces no service, config key, CLI flag, record schema, storage, or telemetry channel, and changes no hook wiring, settings schema, or skill symlink. Operator restart verbs and bare-run exits are excluded. Small-tier architecture, conflict, and coherence artifacts are not required.
