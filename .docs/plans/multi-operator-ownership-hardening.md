# Plan: Multi-operator ownership hardening

**Stories:** `.docs/stories/multi-operator-ownership-hardening.md`
**Complexity:** L (`.docs/complexity/multi-operator-ownership-hardening.md`)
**ADR:** `adr-2026-07-01-machine-scoped-operator-identity` (Approved)
**Track:** technical

Test-first (RED → GREEN) per harness TDD. Every gate/identity task asserts its negative
path with the adversarial inputs named in the stories.

## Task Dependency Graph

```
Slice A (independent of #168 — build now):
  A1 ─▶ A2 ─▶ A3
  A1 ─▶ A4
  A5 (docs) standalone
  A6 (daemon loud un-owned) depends on A3

Slice B (gated on PR #168 engineer-worktree-isolation merge):
  B1 ─▶ B2
```

**Dependencies:** Slice A has no dependency on other open PRs. Slice B depends on #168
(rewrites authoring.ts/land-spec.ts/intake-marker.ts — see `.docs/conflicts/`). Build A
first; start B only after #168 merges.

---

## Slice A — identity + config + daemon (independent)

### A1 — Machine-identity read seam (D1) — 5 min
- RED: unit test `resolveMachineSpecOwner(userConfig)` reads `spec_owner` from a supplied
  USER config object only; ignores any project config.
- GREEN: add a dedicated read that takes the user-config `spec_owner` (via `readUserConfig`)
  and feeds `resolveDaemonOwner`'s `OwnerConfig`. Do NOT switch the daemon/engineer to
  `loadMergedConfig`; keep project config out of the identity path.
- Files: `owner-gate/identity.ts` (or a small `owner-gate/machine-identity.ts`),
  `config.ts` (`readUserConfig` reuse).

### A2 — Wire daemon identity to the machine read (D1) — 4 min
- RED: test that `daemon-cli` resolves owner from user config, not `loadConfig(projectRoot)`.
- GREEN: in `daemon-cli.ts:~183` resolve `spec_owner` via A1's read (user config), leaving
  project `loadConfig` for everything else.

### A3 — Daemon fails closed on unresolved identity (D3) — 5 min
- RED: test that with no user `spec_owner` and gh unresolved, a poll pass dispatches NOTHING
  and emits the distinct "identity unresolved" log; assert no build is started.
- GREEN: change the daemon path so an unresolved owner short-circuits dispatch (build
  nothing) instead of the current fail-open (gate inactive → build all). Reuse the
  `.daemon/warned/` dedup for the notice.
- Files: `daemon-cli.ts`, `daemon-backlog.ts` (gate-active branch).

### A4 — Anti-leak guard: reject project-level spec_owner (D2) — 4 min
- RED: test `validateConfig` fails with a named-file error when a PROJECT config carries
  `spec_owner` (including a blank value); passes when absent.
- GREEN: add the guard to `validateConfig` (config.ts); message names the file + fix
  ("move spec_owner to ~/.ai-conductor/config.yml").

### A5 — Cutover doc + optional self-host warn (D6) — 5 min
- Docs: operator setup + self-host docs state `owner_gate_cutover` is a per-repo policy and
  MUST NOT be set on the harness self-host repo. Update README / self-host README /
  `project_owner_gate_operations` guidance.
- Optional GREEN (if guard chosen): non-fatal validate warning when cutover is set AND
  self-host is detected. (Story 7 second bullet — include only if approved as guard.)

### A6 — Loud un-owned at daemon discovery (D5) — 4 min
- RED: test that an un-owned merged spec (no `Owner:` marker) yields a distinct, deduped
  "un-owned, add Owner marker" skip log (not a silent `continue`).
- GREEN: in `daemon-backlog.ts` un-owned branch, route the skip through `warnOnce` with the
  distinct message. Depends on A3 (gate-active path).

---

## Slice B — authoring stamping (GATED on PR #168)

### B1 — Universal stamping from the conduct DECIDE path (D4) — 5 min
- RED: test that a spec authored via the plain `/conduct` DECIDE path writes
  `.docs/intake/<slug>.md` with `Owner: <resolved id>` identical to the `/engineer` path.
- GREEN: call `writeIntakeMarker` with the machine-resolved author identity (A1 chain) from
  the conduct DECIDE authoring path, atop #168's restructured code.
- Files: `engineer/intake-marker.ts` (post-#168), the conduct DECIDE authoring entry.

### B2 — Authoring refuses to land un-owned (D3) — 4 min
- RED: test that landing with unresolved identity is REFUSED (loud error) and creates NO
  branch / marker / artifact.
- GREEN: add the fail-closed guard to the land path (`land-spec.ts` post-#168) before any
  write.

---

## Out of scope
- Distributed build-lease / cross-checkout claim (the *shared-pool* model) — this spec is
  the *static ownership partition* only. That remains a separate future spec.
- Changing `decideSpecGate` (owner-gate #175) — unchanged; this spec only feeds it a
  correctly-sourced owner and stamps.
