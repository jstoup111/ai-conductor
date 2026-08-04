# Track: BUILD repair preserves stale wiring pass and halts before review (#1249)

Track: technical

Engine-internal correctness fix to BUILD-verification member satisfaction: the kickback status
demotion, the divergence between the selector's verdict-authoritative `gateSatisfied` and the gate's
state-only `stepSatisfied`, and the use of an on-disk gate verdict as authority to skip a member. No
user-facing product capability and no new product surface — the only externally visible changes are
that a repaired BUILD rejoins verification instead of parking `needs-human`, and that new daemon
events show each member's reuse-versus-recompute decision. Acceptance criteria live directly in the
stories. Source: intake jstoup111/ai-conductor#1249.
