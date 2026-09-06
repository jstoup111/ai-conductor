# Architecture Review: Inbound intake trust boundary (#1479)

**Date:** 2026-09-06
**Tier:** M — lightweight pre-stories review (Feasibility + Alignment)
**Inputs reviewed:** .docs/track/github-issue-text-reaches-an-autonomous-build-with.md (scope boundary B: delimit + neutralize + audit, intake-only, no privilege change); operator-approved diagram .docs/architecture/github-issue-text-reaches-an-autonomous-build-with.md; repo-wide sweep of all 307 ADRs. Stories and plan do not yet exist.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

All seams are existing and verified by source read (100%): `buildText()` in
`intake/github-issues.ts` is the sole join point; `parseEnvelope` in `intake/port.ts` is
additive-tolerant of optional fields; `createFileQueue` serializes the whole `Envelope` as
JSON so a new field round-trips; `persistClaimRecord` / `loadClaimRecord` in
`engineer-cli.ts` already carry a per-`sourceRef` JSON record; `EVENT_SINKS` is typed over
`ConductorEvent['type']` so the new variant is compile-enforced to declare sinks;
`formatWorkRef` in `engineer/source-ref.ts` is the canonical `sourceRef` formatter. No new
dependency, service, port, or database. The seam is pure and testable with fixtures.

Prerequisite: none. Integration surface: `intake/` (adapter, port, new module), `engineer-cli.ts`
(claim echo, worktree append), `types/events.ts` + `engine/event-sinks.ts`, composer/engineer
skill prose, `docs/`. Worktree isolation: the only new write is worktree-local
(`<worktree>/.pipeline/intake-events.jsonl`); the engineer-dir claim record is a per-`sourceRef`
file already written once at claim.

Corrections applied to the approved diagram during this review (verified against ADRs):
the sibling ledger moves from the engineer dir to the worktree's `.pipeline/` and is written
at `worktree --source-ref` time, because the engineer dir is a cross-repo directory with
concurrent writers (adr-2026-08-12 amendment); the `EVENT_SINKS` declaration is added.

## Alignment

Governing ADRs applied: adr-009 (additive Envelope evolution, non-empty `text`), adr-011
(decision 2 amended in place — `text` is the sanitized projection of `title+body`), adr-012
(dedup on `sourceRef`, digest is never a key), adr-2026-07-21 (`ClaimOutcome` untouched),
adr-2026-07-26 (sink declaration), adr-2026-08-09-hook-owned-containment-event-ledger and
adr-2026-08-08-pipeline-owned-closeout-timestamps (worktree-local sibling ledger, same schema,
best-effort append), adr-2026-07-22-coherence-gate-placement (staged outcome body is the
sanitized text — decision 8), adr-2026-08-24 (no mismatch to waive because one text is
carried end-to-end), adr-2026-07-22-canonical-tagged-source-ref, adr-005 (non-autonomy
unchanged), adr-2026-08-26 (`compose` is the canonical verb; event name is daemon-neutral).

Event spine: channel yes (new variant + sibling ledger); concern occurrence; verdict extend
the union, sibling ledger same schema; exceptions A (no emitter in the CLI process) and B
(one writer per file). No bespoke sidecar; the claim record carries `inbound` as durable
state read by name (exception C), not as an event substitute.

Local pattern basis: `sanitizeIntakeText` in `intake/sanitize.ts` — role: the outbound
scrub at the filing choke point. Traits to preserve: ordered high-precision rule table,
categorized counts in the result, inert placeholders that keep the function idempotent,
pure function with no I/O. Applies because the inbound seam is the same shape at the
opposite boundary. Allowed variation: separate rule set and categories; a segmentation pass
for fenced/indented/quoted regions that the outbound scrub does not need. Rediscovery hints:
`sanitizeIntakeText`, `RedactionCategory`, `PLACEHOLDER` in `intake/sanitize.ts`; fenced-block
exclusion in `adrApprovalStatus`, `engine/artifacts.ts`.

Security boundary: this feature IS the boundary. New untrusted input is validated at the port
(shape), neutralized at the adapter (content), and labelled in-band (provenance).

Scope check: A consumer-facing (the intake/claim engine ships to every registered project);
B n/a; C agnostic — engine-side, and the skill prose scopes `/composer` vs `$composer` on the
same line.

## Domain Integrity

Handled per-cycle by TDD; noted here only: neutralization categories are a closed union, not
free strings; `inbound` is a typed record, not a boolean flag; `parseEnvelope` remains the
single validation point for the field.

## Wiring Surface

| Surface | Production caller/consumer |
|---|---|
| `sanitizeInboundText` (`intake/sanitize-inbound.ts`) | `buildText()` in `intake/github-issues.ts`, on every emitted Envelope |
| `Envelope.inbound` (`intake/port.ts`) | set by the adapter; read by `claim` and `worktree` cases in `engineer-cli.ts` |
| `compose claim` JSON `inbound` + claim record `inbound` | `engineer-cli.ts` claim case (`persistClaimRecord`); read back by `worktree --source-ref` (`loadClaimRecord`) |
| `intake_inbound_sanitized` (`types/events.ts`, `engine/event-sinks.ts`) | appended by `engineer-cli.ts` worktree case to `<worktree>/.pipeline/intake-events.jsonl` |
| Composer / engineer skill prose | `skills/composer/SKILL.md` step 1 (treat `text` as evidence; report `inbound`) |

Early overlap scan (`ai-conductor overlap-scan`): 14 hits on `intake/github-issues.ts`, all
July-2026 spec branches already merged or stale (latest commit 2026-07-20). Advisory only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A neutralization rule mangles legitimate evidence (false positive) | Data | Medium | Medium | Shape-only rules, fence/indent/quote exemption, inert in-place markers, fixture corpus of real issue bodies from `.docs/intake/` |
| Novel directive phrasing passes through (false negative) | Security | High | Medium | Accepted as a floor; armor lines still delimit the region; markers make audits possible; rule set extensible |
| Armor lines or markers break `outcome-staging` / coherence extraction | Integration | Low | High | Armor outside sections; structure-preserving replacement; land-gate tests on a sanitized fixture |
| Ledger append fails in a removed/racing worktree | Technical | Low | Low | Best-effort, never throws (precedent adr-2026-08-09) |

## ADRs Created

- `adr-2026-09-06-inbound-intake-trust-boundary` (APPROVED 2026-09-06 by operator).
- Amendment note added in place to `adr-011-async-intake-queue-and-github-source` decision 2.

## Conditions

1. Stories must include a negative-path story proving the claimable envelope set is identical
   before and after sanitization (only `text` bytes change) and a story that a fenced/quoted
   directive is preserved byte-for-byte.
2. The plan must include the `EVENT_SINKS` declaration and the `parseEnvelope` pass-through
   as explicit tasks — both are silent-failure points if forgotten.
3. Rule categories stay a closed union; adding one is a code change with a fixture, never a
   config string.
