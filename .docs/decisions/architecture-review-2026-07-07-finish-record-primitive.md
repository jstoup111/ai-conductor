# Architecture Review: finish-record primitive — first-try finish-choice marker write (issue #281)
**Date:** 2026-07-07
**Mode:** Lightweight (Tier M) — feasibility + alignment
**Stories reviewed:** none yet (pre-stories review per adr-2026-06-29-architecture-before-stories-convergent-kickback); input = explore output + technical intent
**Verdict:** APPROVED

## Feasibility

All claims verified against source in this worktree:

- **CLI surface pattern exists** (verified): `conduct-ts` subcommands follow the
  `detect<X>Command(argv)` / `dispatch<X>(cmd, cwd)` pair in an engine module, wired into
  the detection chain in `src/index.ts` (shipped-record, registry, engineer, render,
  derive-feedback all follow it). `finish-record` is a mechanical addition —
  `shipped-record-cli.ts` is the direct template, including the malformed-args →
  `guide` (never fall through to the pipeline launcher — bug #178 lesson).
- **Push check is reusable, not reimplementable** (verified):
  `engine/push-evidence.ts` exports `headPushedToUpstream(runGit, cwd)` returning
  `true | false | null` with upstream-ref resolution + `merge-base --is-ancestor`.
  The primitive imports it; no second implementation of the ancestry check.
- **PR check seam exists** (verified): a production `gh` runner seam is already used by
  the completion gate (`makeProductionGh` in `artifacts.ts` for `readStaleHaltTitle`);
  the primitive runs `gh pr view --json url -q .url` through the same injectable-runner
  style for testability.
- **Gate contract is stable** (verified, `artifacts.ts` finish verifier): requires fresh
  `.pipeline/finish-choice` ∈ {pr, merge-local, keep, discard}, daemon mode accepts only
  `pr` (keep/merge-local/discard → non-convergence), `pr` additionally requires
  `state.pr_url`. The primitive writes exactly what the gate reads; gate code is
  untouched.
- **Prerequisites:** none — no schema, no new deps (execa already used), no infra.
- **Worktree isolation:** the primitive writes only under the explicit `--pipeline-dir`
  (absolute path supplied by the conductor in the step prompt); no shared state, no
  ports, parallel-worktree safe.

## Alignment

- **Pattern consistency:** deterministic primitives invoked by skills for mechanical
  tails is the established harness pattern (`shipped-record` invoked by /finish;
  `engineer land/handoff` invoked by /engineer). This extends it, no new pattern class.
- **Boundary:** reasoning (which choice, whether gates block) stays in the skill;
  verification + atomic writes move to the primitive. The engine does NOT write the
  marker itself — honoring "fix at the skill, not an engine workaround" (#156→#161
  lesson): the skill self-enforces by ending with the command.
- **Fail-closed discipline:** matches adr-2026-07-06-daemon-false-ship-guard — any
  verification failure (including `null`/indeterminate push evidence and gh spawn
  errors, e.g. the known child-PATH ENOENT class, bug #290) → exit non-zero, ZERO
  writes. A missing marker remains the "finish refused" signal; semantics unchanged.
- **State management:** write order is `conduct-state.json` (pr_url) first,
  `finish-choice` last — the marker is the commit point; no half-state where the gate
  sees a choice without its pr_url.
- **Diagram accuracy:** `.docs/architecture/finish-step-fails-try-1-on-every-daemon-ship-skill.md`
  + sequence diagram written this session and match this design.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Transient gh error at verify time refuses a genuinely-shipped PR (try-1 failure persists for that ship) | Integration | Low | Medium | Primitive prints an actionable one-line reason; skill may retry the command once in-turn; refusal is still correct-side (no false-ship) |
| Skill ends its turn without invoking the primitive at all (instruction-drop moves up one level) | Knowledge | Medium | Medium | Exit contract is ONE command instead of ~6 steps — the engine auto-mode prompt names the exact command line verbatim; retry path unchanged as backstop |
| conduct-state.json concurrent write clobbers other fields | Data | Low | Medium | Read-modify-write preserving unknown fields; only pr_url is set |

No High-impact risks registered.

## ADRs Created

- `adr-2026-07-07-finish-record-primitive.md` (DRAFT → presented for operator approval)

## Conditions

None.
