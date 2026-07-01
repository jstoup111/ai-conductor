# ADR 2026-07-01: Machine-scoped operator identity + fail-closed ownership gating

Status: Approved
Track: technical
Related: adr-2026-06-30-owner-gate-identity-resolution, decision_daemon_owner_gate_spec (#175)

## Context

Two operators (e.g. James, Bill) run daemons on separate machines against the same
GitHub repo. Each daemon must build ONLY specs its own operator authored — no
duplication, no silent stalls. The owner-gate (#175) already provides the *decision*
(`decideSpecGate`: build iff `spec.stamp.id == daemonOwner.id`, else `other-owner` skip).
Four structural gaps break it in practice:

1. **Identity is not machine-scoped.** The daemon (`daemon-cli.ts:183`) and authoring
   (`engineer-cli.ts:538`) read `loadConfig(projectRoot)` — project-only. `spec_owner`
   therefore can only be set by committing it to the shared repo, and `mergeConfigs`
   (`config.ts:754`) gives project precedence over user — so a committed `spec_owner`
   would LEAK one operator's identity to everyone who pulls. `loadMergedConfig` (reads
   user config) has no callers in the identity path.
2. **Unresolved identity fails OPEN.** With no resolved owner the gate is skipped entirely
   → the daemon builds everything. A misconfigured/unauthenticated daemon builds *all*
   operators' work — the exact multi-operator hazard.
3. **Only `/engineer` stamps.** `writeIntakeMarker` runs in `engineer/authoring.ts:572`
   and `land-spec.ts:257`; a spec authored via plain `/conduct` DECIDE gets no `Owner:`
   marker → un-owned.
4. **Un-owned is silent.** An un-owned merged spec resolves to `unowned-indeterminate` and
   is skipped by every daemon with no signal → work stalls invisibly.

Constraint: lightweight — GitHub stays the only shared substrate; no broker/queue/new
infra; identity stays behind the `resolveDaemonOwner` seam.

## Decision

### D1 — `spec_owner` is machine-sourced (structural anti-leak)
Operator identity is read **only** from user config (`~/.ai-conductor/config.yml`), via a
dedicated identity read that bypasses the project-over-user merge. The daemon and
authoring never read `spec_owner` from project config. Resolution chain (unchanged shape,
new source): **user-config `spec_owner` → `gh` login → unresolved**. Leak is impossible by
construction — identity never reads shared/committed state.

### D2 — Anti-leak guard is fail-closed
`validateConfig` REJECTS (hard config-load error, not a warning) a `spec_owner` key present
in a committed project `.ai-conductor/config.yml`, naming the file and the fix. A repo can
never carry an operator identity.

### D3 — Unresolved identity is fail-closed
When neither user-config `spec_owner` nor `gh` login resolves an owner:
- **Daemon:** builds NOTHING; emits a loud, distinct log (`daemon identity unresolved: set
  spec_owner in ~/.ai-conductor/config.yml or authenticate gh`). Reverses today's
  fail-open.
- **Authoring/land:** REFUSES to land the spec (no un-owned spec is ever created).

### D4 — Universal stamping
Every DECIDE authoring path writes the `Owner:` intake marker, not just `/engineer`. The
plain `/conduct` DECIDE path calls the same `writeIntakeMarker` with the resolved author
identity (D1 chain). No authored spec is un-owned.

### D5 — Un-owned merged specs are surfaced loudly
A daemon that encounters an un-owned merged spec (legacy / pre-hardening) logs a distinct,
deduped line explaining it is skipped and how to fix it (add an `Owner:` marker on the
default branch). Never a silent skip.

### D6 — Cutover stays a per-repo policy; NOT on the self-host repo
`owner_gate_cutover` remains a legit committed per-repo policy for repos with an UNBUILT
pending backlog. It MUST NOT be set on the harness self-host repo: every plan there is
already built+merged, so grandfather (`build:true` for merged-before-cutover) would rebuild
all of them. Documented in operator setup + self-host docs. (No code change; guard/doc.)

## Consequences

- **Positive:** cross-operator leak is structurally impossible (D1); an unidentified daemon
  can never build another operator's work (D3); no authored spec is un-owned (D4); no
  silent stalls (D5). The `resolveDaemonOwner` seam is preserved — a future
  `PlatformIdentity` (EKS/OIDC) resolver slots in ahead of the user-config read (aligns
  with "design for isolated EKS, keep identity seams swappable").
- **Negative / accepted:** an intentional config asymmetry — `spec_owner` is user-only while
  all other keys remain project-over-user. Documented as correct (identity is inherently
  machine-scoped). Fail-closed adds a one-time setup step per machine (set `spec_owner` or
  authenticate `gh`); this is the deliberate trade for multi-operator safety.
- **Migration:** existing daemons relying on `gh` login keep working (still in the chain).
  Any repo that committed a project-level `spec_owner` will now fail config load until the
  key is moved to user config — an intended, loud break with a clear message.

## Negative-path derivations (per call site)
- Unresolved owner at daemon start → build nothing + loud log (not fail-open build-all).
- `spec_owner` in committed project config → config load REJECTED, named file + fix.
- Un-owned spec at land → land REFUSED, no artifact created.
- Un-owned merged spec at discovery → skipped with a distinct deduped log line.
- gh resolves but user-config `spec_owner` also set → user-config wins (explicit over
  ambient), deterministic.
