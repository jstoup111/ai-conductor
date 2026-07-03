**Status:** Accepted

# Stories: Multi-operator ownership — Slice B (authoring-side)

**Track:** technical (no PRD — derived from issue jstoup111/ai-conductor#184, parent
Stories 4–5 of `multi-operator-ownership-hardening.md`, and the approved architecture)
**Governing ADR:** `adr-2026-07-01-machine-scoped-operator-identity` (APPROVED)
**Architecture review:** `architecture-review-2026-07-02-multi-operator-ownership-slice-b.md`
(APPROVED WITH CONDITIONS — conditions 1–5 are binding on these stories)

These stories **supersede the interim authoring behavior** shipped with Slice A (PR #183):
identity read from the target project's config with guard failures swallowed to `{}`, and
un-owned specs stamped silently. They **re-anchor parent Story 4** to the post-#185
worktree architecture: a refused land creates no commit/marker/staged artifacts, but the
pre-existing per-idea worktree and its `spec/<slug>` branch are retained
(keep-on-failure, FR-6) — the parent's "no branch created" wording is obsolete.

---

## Story 1 — Authoring identity comes from the machine, never the target repo

**Requirement:** #184 interim-cleanup (parent D1 applied to authoring); arch-review conditions 4–5

As an operator on a shared repo, my authoring identity is resolved from MY machine's
user config so another operator's committed config can never impersonate or misroute me.

### Acceptance Criteria

#### Happy Path
- Given `~/.ai-conductor/config.yml` (user config) carries `spec_owner: bob`, when the
  engineer loop or `engineer land` CLI resolves the authoring identity, then the identity
  chain receives `spec_owner: bob` via `readMachineOwnerConfig()` and the landed marker
  carries `Owner: bob` — `loadConfig(target.canonicalPath)` is no longer consulted for
  identity at either call site.
- Given no user-config `spec_owner` but an authenticated `gh` (login `ghlogin`), when
  authoring identity is resolved, then the marker carries `Owner: ghlogin` (chain
  fallback unchanged).

#### Negative Paths
- Given the TARGET repo's committed project config carries `spec_owner: alice` and the
  user config carries `spec_owner: bob`, when a spec is authored and landed via the loop
  or the CLI, then the marker carries `Owner: bob` — the project-config value is never
  read into the identity chain (adversarial impersonation input, parent D2).
- Given the target repo's committed project config carries `spec_owner: alice` and
  NO user-config `spec_owner` exists but `gh` resolves `ghlogin`, when a spec is landed,
  then the marker carries `Owner: ghlogin` and at no point does a config-load failure
  degrade to an empty config on the identity path (the interim `ok ? config : {}`
  swallow is gone).
- Given identity is unresolved (no user `spec_owner`, `gh` unauthenticated), when the
  engineer loop starts authoring an idea or the `engineer land` CLI is invoked, then a
  fail-fast check refuses BEFORE DECIDE authoring begins (loop) / before `landSpec` is
  entered (CLI), with the actionable error of Story 2 — no authoring effort is wasted on
  a spec that cannot land.

### Done When
- [ ] `src/conductor/src/engine/engineer/loop.ts` (interim read ~L542) and
      `src/conductor/src/engine/engineer-cli.ts` (interim read ~L591) resolve
      `ownerConfig` via `readMachineOwnerConfig()` from
      `owner-gate/machine-identity.ts`; neither call site passes
      `loadConfig(target.canonicalPath)` output into the identity chain.
- [ ] The two interim tests are REWRITTEN (not kept alongside) to the final contract:
      `test/engine/engineer/engineer-cli-land-owner.test.ts` and
      `test/engine/engineer/loop.test.ts` "does NOT honor a project-config spec_owner"
      now assert identity comes from USER config (project `spec_owner: alice` present,
      user `spec_owner: bob` → `Owner: bob`), not the gh fall-through.
- [ ] A loop test asserts the fail-fast entry refusal: unresolved identity → loop
      reports the refusal and dispatches no DECIDE authoring.

---

## Story 2 — Landing refuses loudly when identity is unresolved (fail-closed)

**Requirement:** #184 B2 (parent Story 4 / D3, re-anchored post-#185); arch-review conditions 1, 3

As an operator, I can never create an un-owned spec — an unresolved identity refuses the
land instead of silently stamping nothing.

### Acceptance Criteria

#### Happy Path
- Given identity resolves (user config or gh), when `landSpec` runs in the per-idea
  worktree, then the spec commit is created on the worktree's `spec/<slug>` branch and
  `.docs/intake/<slug>.md` carries `Owner: <id>` (no regression to the engineer path).

#### Negative Paths
- Given identity is unresolved (empty `ownerConfig`, `gh` fails or is uninjected), when
  `landSpec` is invoked in a worktree containing valid Accepted artifacts, then it throws
  a loud error BEFORE any write: `git status` in the worktree shows nothing newly staged,
  NO `.docs/intake/<slug>.md` marker exists, and `git log` shows no new commit on
  `spec/<slug>`.
- Given that refusal, then the worktree and its `spec/<slug>` branch still exist
  (keep-on-failure, FR-6) — retained for inspection, NOT deleted; the target's primary
  tree is untouched.
- Given that refusal, then the error message names BOTH remediation paths verbatim
  enough to act on: set `spec_owner` in `~/.ai-conductor/config.yml`, or authenticate
  via `gh auth login`.
- Given identity is unresolved and the worktree's artifacts are ALSO invalid (e.g. a
  DRAFT ADR), when `landSpec` is invoked, then the land still refuses with no writes —
  fail-closed ordering means no guard path stamps a marker or stages files before the
  identity gate fires.

### Done When
- [ ] `landSpec` (`src/conductor/src/engine/engineer/land-spec.ts`) throws on
      `ownerResolution.resolved === false` before `writeIntakeMarker`, `git add`, and
      `git commit`; the un-owned `specOwner = null` stamp path is removed.
- [ ] The refusal error string contains `~/.ai-conductor/config.yml` and
      `gh auth login`.
- [ ] A test asserts the full no-write contract after refusal: no marker file, no staged
      paths, no new commit, worktree directory still present.

---

## Story 3 — Every DECIDE path stamps the owner: plain /conduct included

**Requirement:** #184 B1 (parent Story 5 / D4); arch-review condition 2

As an operator, a spec I author via plain `/conduct` DECIDE (not `/engineer`) is owned
identically to an engineer-authored one, so the daemon's owner gate can build it instead
of skipping it as un-owned.

### Acceptance Criteria

#### Happy Path
- Given a spec authored via the plain `/conduct` DECIDE path producing
  `.docs/plans/<plan-stem>.md`, and a resolved machine identity `bob`, when the DECIDE
  artifacts are finalized, then `.docs/intake/<plan-stem>.md` exists carrying
  `Owner: bob` — keyed by the **plan stem** (the daemon's discovery unit), written via
  the existing `writeIntakeMarker` (no second writer implementation).
- Given a spec authored via `/engineer`, when it lands, then it stamps exactly as before
  (no regression; single shared writer).

#### Negative Paths
- Given the conduct-DECIDE marker would be keyed by anything other than the plan
  filename stem (e.g. the raw idea slug), then the contract test fails — the marker path
  MUST equal `.docs/intake/<plan-stem>.md` for the exact `.docs/plans/<plan-stem>.md`
  the daemon discovers (arch-review High-impact risk).
- Given an intake marker ALREADY exists for the slug (e.g. engineer-intake origin with a
  `Source-Ref:` line), when the conduct path stamps the owner, then the existing
  `Source-Ref:` is preserved — owner stamping never destroys the issue-origin link
  (invariant side-effect on alternate branch).
- Given identity is unresolved on the plain conduct path, when DECIDE artifacts are
  finalized, then the stamping step refuses loudly (same fail-closed rule and error text
  as Story 2) rather than writing a marker with no `Owner:` line or silently skipping.

### Done When
- [ ] The conduct DECIDE tail (where the plan artifact is finalized) calls
      `writeIntakeMarker(repoRoot, <plan-stem>, sourceRef?, <machine-resolved owner>)`;
      grep shows no new/duplicate marker-writing implementation.
- [ ] A contract test authors a plan via the conduct path and asserts
      `.docs/intake/<plan-stem>.md` exists with `Owner: <id>` for the same stem the
      daemon backlog resolves (`daemon-backlog.ts` marker read).
- [ ] A test asserts an existing `Source-Ref:` survives owner stamping.
- [ ] A test asserts unresolved identity on the conduct path refuses with the Story 2
      error, writing nothing.

---

## Out of scope

- Distributed build-lease / cross-checkout claim (future spec, per parent plan).
- `decideSpecGate` (owner-gate #175) — unchanged; it consumes the stamps produced here.
- Daemon-side behavior (Slice A, shipped in PR #183).
