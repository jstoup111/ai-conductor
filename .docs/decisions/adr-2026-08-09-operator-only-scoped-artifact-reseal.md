# ADR: Operator-only scoped reseal of protected DECIDE artifacts

**Date:** 2026-08-09
**Status:** APPROVED
**Deciders:** Operator (jstoup111), architecture-review for #1281

## Context

A seal-protected DECIDE artifact that turns out to need a correction strands its feature
permanently. BUILD cannot repair it, so a kickback is a guaranteed no-op and the feature halts
`needs-human`. The only recovery documented today
(`docs/runbooks/stalled-or-stuck-feature.md:694-733`) is an `npx tsx` heredoc that imports
`rotateProtectedArtifactSeal` directly.

Three forces constrain the fix:

1. **The seal is a tamper-detection boundary.** Whatever we add must not weaken the property that
   a genuine feature-authored BUILD/SHIP edit to a protected artifact still halts.
2. **The existing rotation primitive is not scoped.** Verified: `rotateProtectedArtifactSeal`
   (`protected-artifact-seal.ts:911`) computes the next seal via `createSeal()` (`:486`), which
   re-fingerprints **every** committed protected artifact at `toCommit`. Its `paths` argument is
   recorded in the audit entry and constrains nothing. The blessed runbook recipe is therefore a
   blanket reseal that silently launders any other drifted artifact.
3. **This repository's Design Principle** requires deterministic machinery over prompt discipline.
   "Operators shouldn't run this from inside a build" is prompt discipline; a mechanism that
   refuses is machinery.

## Options Considered

### Option A: Thin CLI over the existing `rotateProtectedArtifactSeal`
- **Pros:** Smallest diff; matches the currently documented recipe exactly.
- **Cons:** Blanket reseal wearing enumerated flags. It would appear scoped while laundering every
  other drifted protected artifact, and would make that unsafe act one keystroke instead of a
  deliberate heredoc. Fails #1281's explicit "never a blanket reseal everything" outcome.

### Option B: A separate scoped primitive alongside `rotate`
- **Pros:** Correct safety properties.
- **Cons:** Duplicates the atomic-write, audit-append, and observer-notification logic, giving two
  code paths that must stay in sync for a boundary where divergence is a security bug.

### Option C (chosen): Extract the shared writer, parameterize the head
- **Pros:** Correct safety properties with no duplicated logic. `rotate` keeps its exact current
  behavior, so the regression surface on the automatic path is nil.
- **Cons:** A refactor of a safety-critical module is part of the change, so the tests must pin
  `rotate`'s behavior as unchanged rather than only testing the new path.

### Option D: Extend the DECIDE-owned amendment path instead of adding a command
- **Pros:** No escape hatch to misuse; single authority for artifact change.
- **Cons:** Does not address the stranding. The plan is already sealed, and routing back to `plan`
  is forbidden in this repository (a `needs-human` HALT is the correct terminal state). Leaves the
  operator with no recovery at much larger cost.

## Decision

**Adopt Option C**, with four specific commitments.

### 1. One shared writer, two heads

Extract `rotateProtectedArtifactSeal`'s self-contained tail — build the `rebaselines[]` entry,
write to a temporary path, atomically rename, notify the observer, clean up — into a single shared
writer. Parameterize the *head* that computes the next seal:

- `rotate` supplies the existing recompute-everything head (`createSeal()`), unchanged.
- `reseal` supplies a **scoped** head: start from the current seal, replace fingerprints only for
  the enumerated paths, leave every other entry at its sealed value.

The scoped head must not add or remove entries. Naming a path absent from the seal is refused —
adding a protected artifact is a different operation with a different threat model.

### 2. The unlisted-drift guard is expressed in `inspectSeal`'s terms, not a new comparison

Reseal refuses the entire operation, naming the offender, when any protected artifact *outside*
the enumerated paths has drifted. Critically, "drifted" MUST mean *what `inspectSeal` already
classifies as a violation* — reusing its existing base-inheritance tolerance and self-amendment
classification — and MUST NOT be a fresh, independent fingerprint comparison.

A second definition of drift would diverge from the one the gate actually enforces, so a reseal
could pass while verification still halts (or vice versa). It would also refuse legitimate
base-inherited changes that a rebase brought in, which `inspectSeal` deliberately tolerates.
One definition, one code path.

### 3. `baselineCommit` advances to the reseal commit

The seal carries one `baselineCommit` while a scoped reseal advances only some fingerprints, so
its semantics must be settled explicitly.

Verified facts: `inspectSeal` never reads `baselineCommit` — it compares only against
`protectedArtifacts` — so verification is unaffected either way. Automatic rotation refuses when
the baseline is an ancestor of HEAD (`same-history-ancestor`, `:292`), firing only on history
rewrite, so advancing along the current history cannot enable an unintended automatic rotation.

`baselineCommit` therefore advances, on the decisive ground that **leaving it stale makes the seal
internally inconsistent with its own declared baseline**: the enumerated entries' fingerprints
would no longer be derivable from `contentAtCommit(baselineCommit, path)`. The unlisted-drift
guard is exactly the invariant that makes the advanced baseline truthful for the *other* entries —
having refused on any unlisted drift, every unlisted entry provably still matches its content at
the new commit.

Corollary constraint: heads read content **at a commit** (`contentAtCommit`), never from the
workspace. The operator must commit the corrected artifact before resealing, and reseal refuses on
a dirty protected-artifact workspace.

### 4. Operator-only is enforced by three independent mechanisms, not by convention

#1281 requires that reseal is "never something a daemon step can invoke". Registering no step is
necessary but **not sufficient** — a build agent holds a Bash tool and could shell out to
`conduct reseal` directly. Three layers, each deterministic:

1. **No step definition exists**, so the daemon can never dispatch it.
2. **Pre-boot dispatch** (the `decide-grant` precedent: detect at `cli.ts:219`, dispatch at
   `index.ts:526`) means the verb resolves and exits before the pipeline boots; it is never
   reachable as pipeline machinery.
3. **An interactive-terminal gate.** Reseal refuses when stdin is not a TTY, behind an injectable
   `isInteractive` seam for tests — the pattern already used at `intake-file-cli.ts:63`,
   `daemon-supervisor-cli.ts:217`, and `install-freshness.ts:216`. A step's provider subprocess
   runs with piped stdio and is refused; an operator at a terminal is not.

A non-empty `--reason` is mandatory and is recorded verbatim; reseal refuses without one.

## Consequences

### Positive
- A permanently stranded feature becomes recoverable by one audited command.
- Closes a laundering hole that exists in the *currently documented* recovery, so the safety
  posture improves rather than merely getting more convenient.
- `rotate`'s behavior is byte-identical, so the automatic rebase path carries no regression risk.
- Audit append, atomic write, and notification stay single-sourced across both heads.

### Negative
- A safety-critical module is refactored, not merely extended. Tests must pin `rotate`'s existing
  behavior explicitly, not just cover the new path.
- The TTY gate blocks legitimate non-interactive operator automation (a recovery script in CI).
  Accepted: reseal is a deliberate human act, and the injectable seam leaves a future opt-in escape
  hatch possible without reopening this decision.
- The unlisted-drift refusal can block an operator whose worktree has unrelated drift, forcing
  them to enumerate or investigate it first. This is the intended cost of never laundering.

### Follow-up Actions
- [ ] Extract the shared writer; prove `rotate` unchanged by test.
- [ ] Implement the scoped head, refusing unknown paths.
- [ ] Implement the unlisted-drift guard in terms of `inspectSeal`'s classification.
- [ ] Wire the `conduct reseal` verb pre-boot, with the TTY gate and mandatory `--reason`.
- [ ] Replace the `npx tsx` heredoc in `docs/runbooks/stalled-or-stuck-feature.md` with the command.
- [ ] Document the flags in `docs/reference/cli.md`.

## Related

- `adr-2026-07-26-protected-artifact-seal-rebaseline` — the automatic rotation this decision leaves
  untouched.
- `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` — the in-phase amendment route;
  reseal is the operator escape hatch for artifacts already sealed past it.
- #1229 (post-rebase seal drift) wants *automatic* rotation of the same primitive; it can reuse the
  shared writer this ADR extracts.
- #1254 (validating `Wired-into:` grammar at authoring time) removes the most common trigger for
  this recovery but not the need for it.
