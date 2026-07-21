# ADR: Stamp Owner at authoring time; default-and-loudly-log an un-owned arrival — never silently skip

**Status:** APPROVED
**Date:** 2026-07-21
**Issue:** #721 · **Stem:** `owner-stamped-at-authoring`
**Relates to:** #695 (`intake-only-enforcement`, PR #719); the owner-gate ADRs
(`adr-2026-06-30-owner-gate-identity-resolution`, `adr-2026-06-30-owner-provenance-recording`,
`adr-2026-07-01-machine-scoped-operator-identity`).

## Context

Spec PR #719 merged with an intake doc lacking an `Owner:` marker; the owner-gate
classified it `unowned-post-cutover` and skipped it **forever** (a `warnOnce`,
deduped-once-then-silent log line — the feature never built). PR #720 remediated by
adding the marker plus a check in `test/test_harness_integrity.sh`.

The operator's binding observation: **that check only protects THIS repo.** Consumer
projects deploy the harness (`conduct-ts`) but never run `ai-conductor`'s integrity
suite. In the wild nothing stops an un-owned intake doc from being authored and merged,
and the daemon will skip it forever, silently — the exact #719 failure. It is
**recurring**: two subagent-authored batch-spec sessions this week each missed `Owner:`.

Enforcement must therefore be **harness-native machinery carried by the deployed
runtime**, deterministic (CLAUDE.md "deterministic where possible"), and must NOT
introduce a new merge-time or dispatch-time rejection (the #695 "no new downstream
failure mode" principle applies).

There are exactly two `Owner:` chokepoints in the deployed runtime — both ship to
every consumer:

- **Write:** `writeIntakeMarker` (`engineer/intake-marker.ts`), the sole writer of
  `.docs/intake/<slug>.md`. It already stamps `Owner:` when handed an identity.
  `land-spec.ts` and `conductor.ts` resolve fail-closed; `authoring.ts` alone degrades to
  a **null, omitted** owner when its local resolver is unresolved — the gap that lets an
  un-owned marker reach the default branch.
- **Read:** `decideSpecGate` (`owner-gate/gate.ts`), consumed by `daemon-backlog.ts`.
  Its `unowned-post-cutover` / `unowned-indeterminate` branches return `{ build: false }`
  — the silent-forever-skip.

## Decision

Adopt a **two-layer, deterministic, harness-native** fix, entirely inside `conduct-ts`.

### Layer A — Born owned (write boundary)

Every conduct-ts path that writes an intake marker stamps `Owner:` from **machine
identity** at creation time. Close the `authoring.ts` gap: fall back to
`readMachineOwnerConfig()` (the operator's `~/.ai-conductor/config.yml` `spec_owner` →
`gh` login chain) — exactly as `conductor.ts` already does — before writing, so
autonomous authoring is born owned even when no `ownerConfig` is injected. Result: **no
conduct-ts write path emits an un-owned marker when machine identity is resolvable.**

### Layer B — No silent dead spec (read boundary) — the escalation DECISION

When a marker nonetheless arrives **un-owned** at read time (hand-written in an editor,
or authored on a pre-this-change harness version), the gate no longer silently skips it
forever. The `unowned-post-cutover` and `unowned-indeterminate` branches return a
**default-build attributed to the daemon's own resolved owner** (new `GateReason`
`unowned-defaulted`), and `daemon-backlog.ts` emits a **loud, actionable escalation**
(naming the slug, the defaulted owner, and how to make ownership explicit) rather than the
deduped-forever silent skip.

**Invariant preserved:** a marker stamped with a **different** owner
(`stamp.present && stamp.id !== daemonOwner.id`) still returns `other-owner` → **SKIP**.
Explicit cross-operator isolation is untouched; `grandfathered` (un-owned merged before
the cutover) is unchanged. Only the ambiguous *un-owned* case changes.

Neither layer adds a merge-time or dispatch-time **rejection/HALT** — Layer B only ever
turns a silent skip into a build-with-loud-log.

## Options weighed (Layer B — the un-owned arrival)

- **Option 1 — Loud-log only, keep the skip.** Reword the skip line louder but still don't
  build. *Rejected:* the spec stays dead. Visibility without a build still leaves the
  operator with a black-holed feature; the directive prefers default/inference, not just a
  better log. (The current message is already fairly loud yet the #719 spec still died.)
- **Option 2 — Infer the owner from git provenance (commit/merge author).** *Rejected:* the
  owner id is a `gh` login (or configured `spec_owner`), while a git author is an email /
  `noreply` handle. The login↔email boundary makes the inferred id unreliable — it cannot be
  matched to the daemon owner id deterministically, so it would misfire (build-as-wrong-owner
  or fail to match its own author). A non-deterministic heuristic is worse than a
  deterministic default.
- **Option 3 — Self-heal: stamp the marker on read.** *Rejected:* writing the `Owner:` line
  to the base branch from the daemon's read path introduces races and mutates base-branch
  state during discovery; the gate must stay a pure, side-effect-free function.
- **Option 4 — Default-build under the daemon's own owner + loud escalation. (CHOSEN)**
  Deterministic, side-effect-free (an ephemeral per-pass build *decision*, not a write),
  closes the dead-spec hole for the dominant single-operator deployment, and preserves
  explicit-owner isolation (`other-owner` still skips). Introduces no new failure mode
  (build-with-log, never reject).

## Rationale

- **Directive compliance.** "Harness-native, any deployment guarantees Owner" is met by
  hardening the two runtime chokepoints (shipped to every consumer), not the repo-local
  test. "No new downstream failure mode" is met because Layer B never rejects/HALTs.
- **Fail at the point of the mistake (CLAUDE.md).** The mistake is *authoring an un-owned
  marker*; Layer A fixes it there. Layer B is the safety net for artifacts authored outside
  conduct-ts, converting a silent death into a visible, built outcome.
- **Determinism over prompt discipline.** Two subagent sessions missed `Owner:` under prose
  rules; machine-identity stamping + a gate default remove the reliance on an agent
  remembering the marker.
- **Single-operator is the dominant deployment.** For it, an un-owned marker is simply the
  operator's own un-stamped spec; defaulting it to the daemon's own owner is correct and
  builds it. The grandfather cutover already builds un-owned *pre-cutover* specs
  unconditionally — extending a **logged, defaulted** build past the cutover is a modest,
  directive-sanctioned continuation of that behavior.

## Consequences

- **Positive:** no un-owned spec can silently die in any deployment; the write paths are
  uniformly born owned; explicit multi-operator isolation (`other-owner`) is unchanged; the
  gate stays pure.
- **Trade-off (multi-operator).** In a shared repo, daemon A could adopt-and-build a
  **hand-written** un-owned spec actually intended for operator B (previously it would have
  silently skipped — i.e. never built anywhere). **Accepted and bounded:** (1) Layer A makes
  un-owned markers near-nonexistent going forward (only editor-hand-written ones remain);
  (2) the loud escalation makes any mis-adoption immediately visible and correctable by
  stamping the intended `Owner:`; (3) a build-with-loud-log is strictly better than a
  dead-silent-everywhere skip. A strict multi-operator deployment keeps isolation by relying
  on Layer A + explicit stamping (an explicit `Owner:` always wins via `other-owner`).
- **Repo-local integrity check (#720) is retained** as a fast local belt for this repo, but
  is explicitly **no longer the sole enforcement** — the runtime layers are.

## Alternatives rejected

- **Prose-only tightening (a stronger "remember Owner:" rule).** Drifts — the very cause of
  the recurring miss.
- **A new auto-installed git pre-commit hook to stamp hand-written markers.** The existing
  git hook (`hooks/pre-commit-tdd-gate.sh`) is opt-in / manually installed, not auto-wired
  to consumers; adding auto-wired hook installation is a consumer-visible breaking surface
  (migration gate) and a new failure surface — heavier than, and redundant with, the
  runtime read-gate default that already catches every un-owned arrival. Left out of scope.
- **A merge-time / dispatch-time rejection of un-owned specs.** Forbidden by the directive
  (a new downstream failure mode) and by the operator's "born owned … not a merge-time or
  dispatch-time rejection" framing.
