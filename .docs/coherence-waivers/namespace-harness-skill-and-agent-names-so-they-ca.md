Waives: outcome-1, outcome-2, outcome-3, outcome-4

Rationale: #885's design was approved in full (`adr-2026-10-14-ac-prefixed-skill-names`). During this DECIDE pass on 2026-10-14 the operator split delivery into two sequenced specs (ADR Decision 7): self-host builds run an engine built from `main` against a copy of the feature worktree's `skills/`, so renaming skills in the same feature that teaches the engine to read the new names would break that feature's own dispatches. This spec (Spec 1) makes every host-visible skill name a read of frontmatter `name:` and changes no visible name, so no #885 outcome is observable from it alone. Every outcome has one named home, follow-up intake jstoup111/ai-conductor#3233, which is blocked on #885:

- **outcome-1** (unambiguous invocation, no shadowing): #3233 flips every name to `ac-<dir>`, removes harness-owned bare links and reports collisions. `agents/` persona files are read by path and never installed into a host namespace, so they cannot collide.
- **outcome-2** (internal cross-references resolve; integrity cross-reference checks pass): #3233 rewrites references and enforces them in the integrity suite.
- **outcome-3** (consumer projects keep working): #3233 ships the consumer `## Migration` block and its migration test. This spec changes no visible name.
- **outcome-4** (operator docs state canonical names): #3233 rewrites operator-facing references to the `ac-` names under integrity enforcement.
