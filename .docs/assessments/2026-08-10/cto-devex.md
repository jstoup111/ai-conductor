# Developer Experience Assessment

**Date:** 2026-08-10
**Reviewer:** Developer Experience Reviewer Agent
**Verdict:** NEEDS_WORK

**Scope note:** This target has two distinct "developers" per the assignment brief: (A) the
human operator running the daemon, and (B) the LLM agent that writes code here. Findings are
tagged `[OPERATOR]` or `[AGENT]` where the distinction matters. This is a CLI/automation harness,
not a web service — Category 3 (docker-compose, seed data, `.env.example`, DB inspection) is
largely N/A by design and marked `UNABLE_TO_ASSESS`/`N/A` rather than penalized.

---

## Category 1: Onboarding
**Status:** PASS

| Severity | Finding | Location |
|----------|---------|----------|
| minor | `docs/quickstart.md` is excellent (verified: every error string it quotes was checked against source, see below) but it is 307 lines and split from `README.md`'s 150-line "Quick start" — a new operator must read two documents to get a first run working, with some overlap (Node/asdf pin mentioned in both). | `README.md:11-58`, `docs/quickstart.md:11-33` |

Verified claims (all `verified`, 100%, by direct source comparison):
- `docs/quickstart.md:149` quotes the exact rejection message for a bare `conduct-ts` invocation; confirmed byte-identical against `src/conductor/src/index.ts:908` (`'conduct: the inline SDLC pipeline now runs under the \`inline\` subcommand.\n'`). This is unusually high documentation-to-code fidelity for a CLI error string.
- `docs/reference/cli.md:12` explicitly states `bin/conduct` (the bash script) is deprecated and undocumented — confirmed the file still exists at `bin/conduct` (3213 lines) and is functional (forwards to `conduct-ts` for most subcommands, `bin/conduct:2652-2655`), so the deprecation is real but the file is not removed. See Category 4 for the drift this produces.
- The prerequisites table (`docs/quickstart.md:16-24`) lists exact verify-commands (`git --version`, `gh auth status`, etc.) and explicitly states `bin/install` checks **none** of them before starting — an honest disclosure of a real gap rather than a claim of robustness.
- "First-run blockers" section (`docs/quickstart.md:163-271`) reproduces five real guard error strings verbatim with recovery steps for each (missing engine bundle, wrong Node version, missing `gh` auth, worktree-root refusal, missing tmux). This is the single strongest onboarding artifact found in the repo — 90% confidence this materially outperforms typical harness READMEs on time-to-first-run, because it pre-answers the exact failure text a new operator will see instead of describing happy-path steps only.

No critical or important onboarding issues found. `verified`.

## Category 2: CI/CD
**Status:** PASS

No issues found.

Verified (`verified`, 95%, read `.github/workflows/ci.yml:1-154`):
- CI runs on every PR (`on: pull_request`), gates on integrity, shellcheck, lint, typecheck (including `typecheck:test` — a deliberate design choice documented inline at `ci.yml:84-86` to catch type errors in test files that vitest would otherwise transpile-and-ignore), the full build+test job, and a link checker.
- `ci-gate` (`ci.yml:131-154`) is a single required-status job that fails if *any* dependency job failed or was cancelled — a real fail-fast aggregator, not a soft summary.
- The `links` job is deliberately **ungated** even for docs-only PRs, with an inline comment explaining why (`ci.yml:109-120`): docs-only PRs skip every other job, so a gated link-checker would create the one PR class that runs zero checks. This is a specific, well-reasoned anti-gap design, not an oversight.
- Release mechanics (`.github/workflows/release-pr.yml`, `release.yml`) are bot-owned and separately gated on PR-merge provenance per `CLAUDE.md`'s Release & Update Gates section; not independently re-verified in this pass beyond confirming the workflow files exist.

## Category 3: Local Development Setup
**Status:** UNABLE_TO_ASSESS (mostly N/A by project shape)

| Severity | Finding | Location |
|----------|---------|----------|
| minor | No `.env.example`; environment variables are instead documented in `docs/reference/environment.md` (not opened in this pass — file existence confirmed via `docs/` tree listing only, so this line is `inferred`, not `verified`). | `docs/reference/environment.md` |

This is a CLI/orchestration tool operating on the operator's own machine and git worktrees, not
a web app with a DB/queue/services stack — docker-compose, seed data, and port-conflict concerns
do not apply. Not counted against the verdict.

## Category 4: Documentation
**Status:** NEEDS_WORK

| Severity | Finding | Location |
|----------|---------|----------|
| important | `bin/conduct`'s own header usage comment is stale relative to the documented-current CLI: it shows `conduct "Build a URL shortener API"`, `conduct --resume`, `conduct --status`, `conduct --step bootstrap`, `conduct --from plan` — but `docs/reference/cli.md:12` says this script is deprecated and undocumented, and the real entry point (`conduct-ts inline`) rejects the bare-string form this comment demonstrates. An agent that reads the script directly instead of the docs (a plausible move — reading source is a normal agent habit) will learn a superseded invocation style. `verified` 90% (comment read directly; deprecation notice read directly; cross-checked against the `inline`-subcommand rejection message confirmed in Category 1). | `bin/conduct:4-17` vs `docs/reference/cli.md:12` |
| minor | `.docs/` has two near-identical top-level directories, `audit/` and `audits/`. This is **not hidden drift** — `docs/reference/artifacts.md:44-45` explicitly documents both, calling `audit/` "no code reference" (free-form, manual) and `audits/` "a one-off backfill" read by exactly one hardcoded path in `shipment-audit.ts`. Confidence 95% `verified` (read the table row and the `.docs/` listing directly). Severity is minor rather than important specifically *because* the docs disclose the drift instead of leaving a new contributor to discover it — a reader of `artifacts.md` cannot be confused; a reader who only sees the directory listing (not the docs) could still create a third `audit_log/`-shaped variant by convention-guessing. |
| minor | The `.docs/` artifact taxonomy has 20 entries (`docs/reference/artifacts.md:38-58`, "Twenty entries. Alphabetized; the five with no code reference are marked."). Five of twenty (`audit/`, `manual-test-results.md`, `observation/`, `phase7-daemon-validation.md`, `retired/`) are explicitly marked "no code reference" in the same table — i.e., a quarter of the taxonomy is manual/legacy convention with no gate or reader enforcing its shape. The table itself is a strong mitigant (a newcomer has one canonical page to check rather than reverse-engineering 20 directories from code), so this is `verified` at 90% but rated minor, not important, because the learnability problem is already solved by the reference doc that exists specifically for this purpose. |
| minor | `docs/quickstart.md:285-290` and `:298-307` each carry a "Known limitation" callout (update-channel detection structurally never fires on the default channel; `--uninstall` leaves settings.json hooks pointing at a deleted directory) with tracking issue numbers (#1005, #1004). This is good — a real limitation stated plainly rather than glossed — but both are load-bearing gotchas that only exist in prose; nothing mechanically warns an operator who hits them outside this doc page. `verified` 85% (read directly), severity minor because the doc disclosure itself is the mitigation and matches this repo's own stated philosophy of using prose only as an interim guard. |

No critical documentation issues found — spot-checked doc-to-code fidelity (Category 1) came back
exact, and CI runs a link checker (`ci.yml:121-129`) on every PR including docs-only ones, which
mechanically prevents the most common form of documentation rot (dead links). `verified`.

## Category 5: Debugging Tooling
**Status:** NEEDS_WORK

| Severity | Finding | Location |
|----------|---------|----------|
| important | **[OPERATOR]** Feedback latency for daemon-side failures is structurally late by design, and the harness's own docs concede this. Per `skills/daemon-triage/SKILL.md:14-23`, triage is operator-*invoked*, not automatic — a stalled/halted feature produces no push notification; the operator must notice (poll `conduct-ts daemon status` or be "woken by halts" per the assignment brief) before diagnosis starts. Combined with `CLAUDE.md`'s own admission that 5 of its "Daemon Operations Safety" rules are prose-only interim guards "awaiting machinery" (`CLAUDE.md` Daemon Operations Safety section, items 1-5, confirmed `verified` by reading `AGENT_INSTRUCTIONS.md:46-125` in this worktree), the realistic latency for a class of daemon failures is "however long until the operator happens to check" — potentially hours into an unsupervised build, which is exactly the failure class the assignment brief flags as the core DX defect. This is a design tradeoff the repo has already reasoned about (fail-closed self-host live-boundary halts explicitly accept a false-halt cost, `AGENT_INSTRUCTIONS.md:113`), not an oversight, but it remains a real latency gap. `verified` 85%. |
| minor | `daemon-triage` is thorough and well-designed (read in full, `skills/daemon-triage/SKILL.md`, 310 lines): deterministic signal table (§2, 14 rows, ordered by decisiveness), explicit two named traps for misreading progress (§1, "a pinned counter is not a stalled build" / "a stale heartbeat belongs to whichever step wrote it"), and a hard per-action approval contract for any mutation (§ "The approval contract", lines 25-48) — no batching, no standing consent. This is strong operator DX; flagged here only because its quality is uneven with the onboarding docs' UNABLE_TO_ASSESS gap in Category 3, not because of a defect in the skill itself. |
| important | **[AGENT]** Feedback latency for harness-repo authoring mistakes (the checks in `test/test_harness_integrity.sh`) is commit-time at best, not edit-time. The validation suite must be run manually (`AGENT_INSTRUCTIONS.md:193-196`: "Before every commit... The active host agent MUST run validation automatically"); this is a prompted behavior, not a git hook or IDE-integrated check. An agent mid-edit gets zero signal that it just broke, e.g., the HARNESS.md model table (check 5a) or a skill's frontmatter (check 2) until it remembers to run the 1497-line script. `verified` 80% (confirmed no `.git/hooks/pre-commit` invocation of this script was referenced anywhere in `CLAUDE.md`/`AGENT_INSTRUCTIONS.md`/`HARNESS.md`; only searched the instruction files for a hook wiring claim, did not exhaustively grep `.git/hooks` itself in this read-only worktree, so this is `inferred` for the "no hook exists" half and `verified` for the "prompted, not automatic" half). |
| minor | `test/test_harness_integrity.sh` failure output is genuinely actionable once it runs: every `assert` call was spot-checked (`grep -n 'assert "'`, 40+ call sites) and failure messages consistently embed the specific broken entity name and a remediation command, e.g. `"bin/generate-model-table --check — drift detected in HARNESS.md model table (remediation: run 'bin/generate-model-table' to regenerate)"` (`test/test_harness_integrity.sh:289`) and `"${skill_name} — missing: ${missing[*]}"` (`:187`). This is high quality for the failures it does report at all — the gap is entirely about *when* the developer/agent learns about them (see the important finding above), not the message quality once surfaced. `verified` 90%. |
| unable_to_assess | Per-test isolation (running a single test in isolation), REPL/console access, and log tailing were not independently re-verified beyond confirming `package.json` exposes `test:watch` (vitest watch mode, supports isolated re-runs) and `test:changed` (changed-file-scoped run). Did not open individual `*.test.ts` files or vitest config to confirm no global setup blocks single-test execution. `inferred`, not scored. |

---

## Summary

**Overall Verdict:** NEEDS_WORK

**Critical findings:** 0

**Important findings:** 3
1. `bin/conduct`'s header usage comment demonstrates a superseded, now-rejected invocation form for a script the docs call deprecated — an agent reading source instead of docs learns the wrong CLI contract (`bin/conduct:4-17`).
2. Daemon-side failure feedback is operator-poll-latency, not push-latency, by explicit design; combined with 5 admitted prose-only safety rules awaiting machinery, a class of failures can go unnoticed for hours into an unsupervised build — this is the specific "late feedback" defect class the assessment brief calls out as core to this repo.
3. Harness-repo validation (`test/test_harness_integrity.sh`, 21 numbered + 3 unnumbered checks) is a prompted manual/pre-commit step, not an edit-time or hook-enforced one — an agent can accumulate several broken invariants (stale model table, bad SKILL.md frontmatter) before the first signal arrives.

**Minor findings:** 5
1. Onboarding is split across `README.md` and 307-line `docs/quickstart.md` with some overlap.
2. `.docs/audit/` vs `.docs/audits/` — real but explicitly self-documented drift, not hidden.
3. 5 of 20 `.docs/` taxonomy entries are "no code reference" (manual/legacy), mitigated by the existing single-page reference doc.
4. Two "Known limitation" callouts in `docs/quickstart.md` are load-bearing prose with no mechanical warning outside that page.
5. `test_harness_integrity.sh` failure messages are high quality once surfaced; only the timing (not the content) is the gap.

**Positive signals worth naming** (not standard checklist items, but relevant to calibrating the verdict): documentation-to-code fidelity was exact on every spot check performed (a CLI rejection string and a deprecation claim both verified byte-for-byte/functionally against source); CI is well-gated with a documented rationale for its one deliberately-ungated job; the `daemon-triage` skill is a genuinely strong, well-reasoned operator-facing artifact with an explicit per-action approval contract. This repo's DX weaknesses are concentrated in feedback *timing* (daemon polling latency, commit-time-not-edit-time validation), not in content quality, accuracy, or completeness of what does get surfaced.
