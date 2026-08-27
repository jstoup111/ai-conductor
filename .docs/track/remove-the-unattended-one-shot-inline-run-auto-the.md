# Track: remove the unattended one-shot inline run (--auto)

Track: technical

Scope boundary: Comprehensive (operator-confirmed): retire examples/inline.sh + examples/README.md row + their tests (re-point at the daemon); add the daemon-guide docs path to the --auto rejection message; delete deriveMode's unreachable 'auto' arm; audit all remaining `'auto'` branches in src/conductor/src/engine/conductor.ts and delete only provably one-shot-only dead code. Excluded: renaming the 'auto' RunMode (rejected Approach B), any change to `inline --interactive` or the default checkpointed inline run, and any daemon behavior change — mode 'auto' remains the daemon's dispatch contract.

Approach A (audit-and-prune) over a RunMode rename: evidence-backed deletion without rippling the daemon hot path's type surface. Source: jstoup111/ai-conductor#1436; most of the flag-level work already shipped in PR #1509.
