# Architecture Review + ADR: CHANGELOG Migration-block enforcement (fix #282)

**Date:** 2026-07-05
**Status:** APPROVED
**Track:** technical · **Tier:** M (lightweight review)
**Feature:** enforce CHANGELOG Migration-block format where authored; auto-remediate format defects
**Track doc:** `.docs/track/2026-07-05-changelog-migration-block-enforcement.md`
**Architecture:** `.docs/architecture/2026-07-05-changelog-migration-block-enforcement.md`
**Stories:** `.docs/stories/2026-07-05-changelog-migration-block-enforcement.md`
**Source:** `jstoup111/ai-conductor#282`

## Scope reviewed

Three self-host mechanisms: (1) an authoring-time format-when-present check in
`test/test_harness_integrity.sh`; (2) routing the self-host release gate's migration-format
failure through `/remediate` as a mechanical `build` disposition; (3) tightening the format
contract to `## Migration` (h2) in the gate + integrity check while keeping `bin/migrate`
lenient. Grounded in `release-gate.ts` (TR-10), `conductor.ts` (finish-time gate at
1068–1077 and the existing `/remediate` dispatch at 1445–1500 / 1560–1629), the integrity
suite §9 (357–437), and `bin/migrate` `extract_migration_blocks` (115–175).

## Concerns (C1–C6)

### C1 — Do not leak self-host language into the shared skill/agent surface (BLOCKING constraint)
`skills/` and `agents/` are consumed by every project using the harness; the Migration-block
gate is a harness-repo-only concern. **Resolution:** all self-host-specific knowledge stays
in the TS self-host module, a `.pipeline/` remediation artifact, `test_harness_integrity.sh`,
`bin/migrate`, and harness-repo docs. The `remediate` skill is only extended (if at all) in a
**generic** way — recognizing an additional `.pipeline/` input source — never with CHANGELOG
or Migration semantics. Stories assert zero harness-specific CHANGELOG strings are added to
`skills/**` or `agents/**` (grep gate). See ADR-1.

### C2 — Fail-closed must survive the new routing
Today an uncertain diff (`changedFiles()===null`) forces a block (fail-closed), and a genuinely
absent block for a breaking surface must never auto-pass. **Resolution:** routing to remediate
does not relax the verdict — the gate still returns `ok:false`; only the *handling* changes
(remediate build kickback instead of immediate HALT). If remediate cannot produce a runnable
block within the kickback budget, the flow falls back to the existing HALT. The integrity §9d
check is **format-when-present only** and must NOT assert presence (it runs on every change,
most of which touch no breaking surface). See ADR-1 + ADR-2.

### C3 — h2 tightening vs shipped h3 history (backward-compat hazard)
The CHANGELOG already contains 5 `### Migration` (h3) headings in released sections, some with
real `bash migration` fences. Tightening `bin/migrate` to h2 would make it silently skip those
when a consumer updates across those versions. **Resolution (ADR-2):** tighten only the
go-forward authoring surfaces (gate + integrity check); leave `bin/migrate` lenient (h2/h3).
The invariant *gate-passing ⟹ migrate-executable* holds because `h2 ⊂ {h2,h3}`.

### C4 — Contract drift across three languages
The format contract now lives in TS (gate), Python (migrate), and bash (integrity). **Resolution:**
(a) update the `release-gate.ts` comment to document the *intentional* gate-strict / migrate-lenient
asymmetry so a future reader does not "re-sync" them wrongly; (b) a focused unit test pins the gate's
h2-accept / h3-reject / plain-fence-reject behavior; (c) a parity assertion (fixture the gate accepts →
`bin/migrate`'s regex also matches) guards the essential invariant. A single cross-language
implementation is explicitly rejected as impractical (three runtimes).

### C5 — "Runnable" content is a judgment call in bash
The reported block was "commentary/examples, not runnable commands." A bash check cannot fully
decide runnability. **Resolution:** §9d uses a tractable proxy — the `bash migration` fence body
must contain at least one non-blank, non-comment (`#`) line. This catches the reported
"comments/examples only" case without over-claiming. Deeper semantic validation is out of scope.

### C6 — Don't author an unnecessary Migration block for THIS PR
This change touches `test/`, `src/conductor/` (self-host), `bin/migrate`, and docs — none are in
the breaking-surface classifier (`bin/conduct`, `bin/install`, `hooks/`, `settings.json`, removed/
renamed `skills/`). **Resolution:** the plan explicitly instructs the build to add a plain
`[Unreleased]` entry with **no** Migration block, to avoid ironically tripping the very check it adds.

## Decisions

### ADR-1 — Route the migration-format gate failure through `/remediate`; keep HALT as fallback
**Status: APPROVED.** When TR-10 fails because a required block is malformed or missing, the gate
writes a `.pipeline/` remediation-input artifact (which breaking surfaces, malformed vs missing,
the exact required format) and the conductor dispatches `/remediate` — mirroring the existing
prd-audit / finish / as-built kickback paths and bounded by `MAX_KICKBACKS_PER_GATE`. Remediate
emits a `build` disposition with a file-scoped task to fix `CHANGELOG.md`; the gate re-runs after
the build. On budget exhaustion, or when a *different* sub-gate fails (TR-7 VERSION, TR-8 integrity
suite, TR-9 empty `[Unreleased]`), the current direct HALT is retained. Only the migration-format
sub-gate is rerouted. Rationale: block-format repair is mechanical work with clear evidence (the
diff names the breaking surface); the by-design human step here is only the merge (ADR-005/ADR-010).

### ADR-2 — Tighten gate + integrity to h2; `bin/migrate` stays lenient (deliberate asymmetry)
**Status: APPROVED.** `MIGRATION_SECTION_RE` in `release-gate.ts` and the new integrity §9d require
exactly `## Migration` (h2), matching the documented contract in CLAUDE.md and the PR template.
`bin/migrate`'s `^###?\s+Migration` regex is **unchanged** (accepts h2/h3) to keep already-shipped
h3 blocks executable. The asymmetry is a stricter authoring gate over a lenient executor (linter
stricter than parser); the invariant *gate-passing ⟹ migrate-executable* is preserved and pinned by
a parity test. This asymmetry is documented in-code so it is not mistaken for drift.

### ADR-3 — Authoring-time check is format-when-present, in the harness's own test script only
**Status: APPROVED.** §9d validates format only *if* a Migration heading is present in the
`[Unreleased]` body; it never asserts presence (presence-for-breaking-surface stays the gate's job,
which has the git diff). It lives in `test/test_harness_integrity.sh` — the harness's own repo-scoped
validation — satisfying C1 (no shared-skill leakage). Because task-12's `full validation` already
runs the integrity suite, this makes a malformed block fail the CHANGELOG task before it can be
marked complete.

## Verification hooks for stories
- Grep gate: no new harness-specific CHANGELOG/Migration string under `skills/**` or `agents/**`.
- Gate unit tests: h2 accept, h3 reject, plain `bash` fence reject, `bash migration` accept, uncertain-diff fail-closed, malformed-vs-missing verdict kind.
- Parity test: gate-accepted fixture matches `bin/migrate`'s regex.
- Integrity self-test: §9d passes clean CHANGELOG, fails a fixture with a plain `bash` fence and with an h3 heading and with a comment-only body.
- Routing test: malformed-block gate failure dispatches remediate (not immediate HALT); budget-exhausted falls back to HALT; TR-8 integrity failure still HALTs directly.
