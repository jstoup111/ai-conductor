# Architecture Review: Phase 9.2 — Project Registry + Creation

**Date:** 2026-06-25
**Mode:** Lightweight (Medium — feasibility + alignment)
**Stories reviewed:** `.docs/stories/phase-9.2-registry-project-creation.md` (11, FR-1..FR-11)
**Verdict:** **APPROVED WITH CONDITIONS**

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | ✅ Node fs + `git` via execa (existing pattern). conduct-ts CLI dispatch exists. No new deps. |
| Prerequisites | ✅ Reuses `~/.ai-conductor/` + `user-config.ts` path pattern; templates exist. |
| Integration surface | New registry module; two conduct-ts CLI subcommands; one `skills/bootstrap/SKILL.md` step. Contained. |
| Data implications | None (no DB). One JSON file, atomic temp+rename. |
| Performance | Negligible (occasional small-file rewrite). |
| Worktree isolation | ✅ Registry is a user-level file outside any repo/worktree. |
| Harness-skill change | `bootstrap/SKILL.md` edit must keep the validation suite green (frontmatter, refs). |

## Alignment

- **Pattern consistency:** ✅ Single-writer lib behind the CLI (ADR-003); path resolution mirrors
  `user-config.ts`; commands in conduct-ts (the active conductor). `create` is a skeleton, not a
  second onboarding (FR-6 × ST-026 resolved).
- **State management:** ✅ `status` provenance preserved (no `created`→`registered` downgrade);
  dedup by canonical path; `ProjectRecord` a typed value; `remote` optional (not empty-string).
- **Security:** ✅ Credential redaction on `remote` (FR-11) — no token to disk. Registry stores no
  secrets.
- **Diagram accuracy:** ✅ `2026-06-25-phase-9.2-registry.md` reflects the single-writer design + A/B.

## Domain Integrity

Per-cycle via TDD domain reviewer. Note (carry the 9.0/9.1 lesson): the correctness-critical
derivations — canonical-path dedup, credential redaction, basename/remote derivation — must be
tested **against real inputs** (a real temp git repo, a real token-bearing URL), not injected
literals.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Concurrent writes corrupt the registry | Technical | Low | **High** | Atomic temp+rename (FR-9); test ≥2 concurrent registrations → valid JSON, all records |
| Credentials written to disk via `remote` | Security | Low | **High** | Redact `user:token@` before write (FR-11); test a token-bearing origin → no token stored |
| `create` clobbers existing work | Data | Low | Medium | No-clobber guard on non-empty target (FR-7); test refuse + nothing-written |
| bootstrap SKILL change breaks validation | Integration | Low | Medium | Run `test/test_harness_integrity.sh` after the SKILL.md edit |

## ADRs Created

- **ADR-003** (`adr-003-registry-write-and-integration.md`, **DRAFT**) — Option A (single writer lib
  behind the CLI; bootstrap calls `conduct register`) + atomic temp+rename, canonical-path dedup,
  status provenance, credential redaction. **Must be APPROVED before BUILD.**

## Conditions (APPROVED WITH CONDITIONS)

1. **ADR-003 APPROVED** before `/writing-system-tests`.
2. Registry writes are **atomic (temp+rename)** and concurrency-safe (closes High-impact risk).
3. `remote` credentials are **redacted** before any write (closes the security risk).
4. All registry writes funnel through the **single registry module** (register/create/bootstrap);
   bootstrap calls `conduct register` (no direct JSON writes).
5. Correctness-critical derivations are tested **against real inputs**, not injected literals
   (9.0/9.1 recurring-lesson).

Tracked into `/plan`, checked at code-review and `/finish`.
