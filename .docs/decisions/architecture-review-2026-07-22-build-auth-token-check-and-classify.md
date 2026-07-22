# Architecture Review: Build-Auth Token — Check and Classify

**Date:** 2026-07-22
**Mode:** Pre-implementation DECIDE review, lightweight (Tier M)
**Inputs reviewed:** PRD `.docs/specs/2026-07-22-build-auth-token-check-and-classify.md`
(FR-1..7 + edges); to-be diagram `.docs/architecture/2026-07-22-build-auth-token-check-and-classify.md`
**Verdict:** APPROVED

## Feasibility

- **Stack:** entirely within the current stack — bash (`bin/install`) formats results;
  all resolution, reading, probing, and classification live in the TypeScript
  conductor. No new dependencies: the liveness probe reuses the installed `claude`
  CLI; the park machinery, token reader, and classifier already exist.
- **Prerequisites:** none beyond an installed CLI (already a `--check` item).
- **Integration surface:** `bin/install` (thin delegate), CLI dispatch chain
  (`index.ts`), `claude-provider.ts` classifier, `group-core.ts` + `conductor.ts` flag
  consumers, `build-auth-preflight.ts`, daemon dispatch loop. Wide but shallow — each
  touch is small and the seams already exist.
- **Data:** no schema, no migrations, no persisted state beyond existing markers.
- **Performance:** probe measured ~2.3s / $0 on invalid; one cheapest-tier completion
  when valid. One extra credential read per daemon dispatch cycle.
- **Worktree isolation:** probe uses a throwaway `CLAUDE_CONFIG_DIR` (existing
  sandbox pattern); health check is read-only; no ports/DBs/services.
- **Empirical grounding:** invalid-token behavior verified live 2026-07-22 (observed
  `Failed to authenticate. API Error: 401 Invalid bearer token`, exit 1; JSON envelope
  `api_error_status:401`). The raw-API-probe alternative could not be verified and was
  rejected rather than assumed (see ADR).

## Alignment

- **adr-2026-07-07 (daemon-owned credential):** seam read, not modified. ✔
- **adr-2026-07-04 (park-and-poll, never retry/escalate):** classification routes 401s
  INTO these semantics on both dispatch paths; the daemon gate reuses the same park
  machinery. Neither ADR amended. ✔
- **Deterministic-first design principle:** all new behavior is machinery (reader,
  probe verdict mapping, regex+fixtures, dispatch-cycle gate) — no LLM judgment, no
  prompt discipline. ✔
- **Single source of truth:** bash never re-derives token path/mode; it delegates to
  the conductor (matches the harness's existing `conduct-ts` delegation pattern). ✔
- **State modeling:** credential state is a closed discriminated union
  (missing / unreadable / invalid / valid / unverifiable) extending the existing
  `ok|missing|error` union — no boolean flags; "unverifiable" prevents the invalid
  state "claims valid without verification". ✔
- **Diagram accuracy:** to-be diagram approved this session; base 2026-07-07 diagram
  unchanged and still accurate.

## Wiring Surface (design-time)

| New surface | Wired from (production path) |
|---|---|
| Build-auth check delegate (conduct-ts subcommand) | `bin/install` `check_installation` invokes it; registered in the `detect*/dispatch*` chain in `src/conductor/src/index.ts` |
| Token liveness verifier module (`engine/self-host/`) | invoked by the check delegate's dispatch |
| Extended auth-failure patterns | existing classifier in `execution/claude-provider.ts`, consumed at `engine/conductor.ts` serial auth branch and `engine/group-core.ts` retry loop |
| Daemon pre-dispatch credential gate | daemon dispatch cycle, before feature dispatch |
| Shared remediation-message builder | consumed by the gate, `build-auth-preflight.ts`, and the check delegate |

**Early overlap scan (advisory):** `bin/install` overlaps with ~29 unmerged spec
branches — it is the repo's hottest spec-touched file. Plan consequence: keep the bash
diff to a minimal delegate call so merge surface stays small. No overlap reported on
the TypeScript files.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Auth regex false-positive parks non-auth failure | Technical | Low | Medium | Patterns anchored to observed error shape (`API Error: 401`, `invalid bearer token`), verbatim fixtures; false-positive recovers on any credential-file touch |
| CLI output/envelope drift across versions breaks probe verdicts | Integration | Medium | Medium | Fail-safe `unverifiable` state — never claims valid without positive signal; envelope fields fixture-tested |
| Expired-token phrasing differs from invalid (inferred ~80%) | Knowledge | Medium | Medium | `failed to authenticate` prefix anchor; probe path uses structured status which covers expiry deterministically |
| Daemon gate masks per-feature preflight regressions | Technical | Low | Low | Preflight retained unchanged + tested independently as backstop |

No High-impact risks registered.

## ADRs Created (DRAFT → pending operator approval)

- `adr-2026-07-22-token-liveness-probe-via-cli-invocation`
- `adr-2026-07-22-auth-failure-classification-observed-401-patterns`
- `adr-2026-07-22-daemon-level-missing-credential-gate`

## Notes

Sections 3 (complexity — already Tier M) and 5 (domain pre-check — TDD per-cycle)
skipped per lightweight mode.
