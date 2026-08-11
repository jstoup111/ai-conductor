# Technical Assessment: ai-conductor

**Date:** 2026-08-10
**Assessed by:** 9 specialist agents + CTO synthesis
**Commit:** `58628e858` (read in a detached worktree; no writes to the live checkout)
**Verdict:** CRITICAL

---

## Executive Summary

This is a codebase with a strong architectural conscience and a weak architectural skeleton. The
machinery it *has* built is genuinely good — a compile-time-total event-sink registry, an AST-based
test-isolation gate, an `O_EXCL` pidfile mutex, a self-eviction-guarded engine GC, argv-array
subprocess discipline almost everywhere, and an outbound secret scrub that redacts to a fixed point
*after* truncation. Nine specialists independently verified those and said so. The problem is not
capability; it is that the same correct idiom exists in this repo three or four times over and was
not applied at the sites that matter most.

**Biggest strength:** the deterministic-machinery instinct is real and demonstrated — `EVENT_SINKS`
(`engine/event-sinks.ts:9`) converts a recurring class of mistake into a compile error, and
`test/structural/test-execution-policy.test.ts` does the same for test isolation. Both are exactly
the "machinery over prompt discipline" the repo's own CLAUDE.md demands.

**Biggest risk:** the intake pipeline. It is simultaneously the only path in the system that ingests
genuinely untrusted third-party text into a `--dangerously-skip-permissions` autonomous build, the
holder of the sole dedup authority (ADR-012), the one durable store in the repo with **no locking
and no corruption handling**, and untested for both of its two known failure modes — while the
correct patterns for all three (`conduct-state-lease.ts`, `halt-issues/ledger.ts`'s quarantine, the
`conduct-state` lost-update regression test) already exist elsewhere in this same repository.

**Second-biggest risk, and the one that costs the most operator hours:** the halt path. The single
event an operator needs the morning after an unattended overnight build — "why did this stop" —
is declared `persist: false` and never reaches `.pipeline/events.jsonl`, the documented single
spine. A second halt class reaches no sink at all. The write that *is* the alerting mechanism
swallows its own failures.

**Ready for its next phase of growth?** No — not without paying down the intake and halt paths
first. Feature work will keep landing successfully (the daemon demonstrably ships features), but
each overnight run carries an unbounded, silent, untested corruption risk in the one store that
prevents duplicate work, and every halt costs a morning of three-file forensics.

---

## Confidence and scope discipline

Every finding below carries the confidence and basis its source specialist assigned. Nothing has
been promoted. Specifically:

- Items the specialists marked **tentative** are marked tentative here and **must be re-verified
  before anyone acts on them.** They are collected in a dedicated section rather than scattered.
- The architecture report contains a visible self-correction (§6.3) in which two of its own
  ADR-corpus figures were wrong *in the pessimistic direction*. The corrected figures are used
  throughout this report: **supersession discipline in the ADR corpus is excellent** — 24 of 24
  superseded records carry a resolvable successor pointer and all 17 unique successors carry a
  matching back-reference; **428 of 432 records carry a parseable disposition** (4 do not, not 176);
  and **54 of 58 sampled `.ts` file citations still resolve**. The earlier, worse numbers are not
  resurrected anywhere below.
- Two dependency checks were **not performed** and are coverage gaps, not clean results: last-publish
  date / abandonment (no registry network access) and install-time deprecation warnings (`npm install`
  was prohibited). Do not read "no abandoned packages found" into this report.

---

## Threat-model framing (read this before the priority order)

This is a **single-operator local tool**. There is no multi-tenancy, no HTTP surface, no untrusted
end user, and no production deployment. Generic CVSS ranking is actively misleading here and has
been deliberately overridden. Two consequences:

1. **A dev-only CVSS 9.8 is not this operator's biggest problem.** The `vitest` 2.1.9 CVE
   (GHSA-5xrq-8626-4rwp) requires `vitest --ui`, which no committed script invokes (verified).
   It is real and should be fixed, but it ranks below anything that corrupts state overnight.
2. **There is exactly one genuinely untrusted-input path, and it matters.** GitHub issue title and
   body flow verbatim into the DECIDE authoring prompt and from there into a provider CLI running
   with `--dangerously-skip-permissions`, with **no inbound sanitization boundary** at all
   (`engineer/intake/github-issues.ts:175,235` → `engineer/loop.ts:520-540`; `intake/sanitize.ts` is
   an *outbound* scrub applied when filing, never on capture — verified, 88%). The one real mitigant
   is that capture is scoped to `--assignee @me` (`tracker-client.ts:216-232`), which a third party
   cannot set. The residual is precise: **a GitHub issue body remains editable by its author after
   the operator assigns it.** So the exposure requires an operator action (assigning a third-party
   issue) but is not theoretical, and it is the only place an outside party has any reach into this
   system at all. It is weighted accordingly — high, but below the silent-corruption items.

Conversely, the three findings the security specialist rated **critical** are code-injection sinks
whose *source* is already inside the trust boundary — LLM-authored assessment markdown
(`bin/conduct:971` → `:515-522`), agent-writable `.pipeline/conduct-state.json` (`bin/conduct:3022`),
and a commit-message `Task:` trailer (`git-hook-assets.ts:232-241`). Against an adversary who already
runs with skipped permissions, these are not a meaningful privilege boundary. **Their real cost to
this operator is robustness, not confidentiality:** an apostrophe in a verdict line or a commit
trailer silently breaks the state machine or the task-attribution gate, and the surrounding
`2>/dev/null || echo "pending"` idiom hides the failure while the malformed code still runs. That
reframing does not make them less worth fixing — it makes them *cheaper* to justify fixing, because
the fix (env vars and `process.argv`) also removes a live correctness bug. They are treated as
high-value quick wins, not as emergencies.

---

## Critical Findings

14 findings were labeled critical across six specialist areas. They collapse to **13 distinct
defects** — the testing specialist's critical (`intake/ledger.ts` has zero coverage for either
known failure mode) is the same object as data-integrity's two, viewed from the test side, and is
merged into #4/#5 below.

| # | Finding | Specialist(s) | Confidence / basis | File(s) |
|---|---------|---------------|--------------------|---------|
| 1 | `save_state` splices arguments raw into an unquoted `python3 << PYEOF` heredoc; the value at the `assess_verdict` call site is grepped out of LLM-authored assessment markdown. **Note: this assessment report is written into exactly the path that call site parses.** | security | 92%, verified | `bin/conduct:515-522` (source `:971`) |
| 2 | `last_step`, read from agent-writable `.pipeline/conduct-state.json`, is interpolated into `python3 -c`; the `2>/dev/null \|\| echo "pending"` fallback hides the error while injected code runs. | security | 92%, verified | `bin/conduct:3022-3023` |
| 3 | The generated `commit-msg` hook splices the commit `Task:` trailer into a single-quoted JS string in `node -e`. The correct idiom (`process.argv[1]`) is already used in the sibling file. | security | 90%, verified | `engine/git-hook-assets.ts:232-241` |
| 4 | `loadStore` catches **every** error including `JSON.parse` failure and returns `{}`; the next `saveStore` persists that empty store over the real file — silently destroying the sole intake dedup authority (ADR-012). No test writes a corrupt ledger. | data-integrity, testing, duplication | 95%, verified | `engine/engineer/intake/ledger.ts:95-102` |
| 5 | The same ledger has **no lock of any kind** — full-file read-modify-write from 7 one-shot CLI call sites concurrently with the long-running intake loop. A lost `transition` clobbers the whole store, producing duplicate claims and duplicate spec PRs. No test exercises concurrency. | data-integrity, testing | 90%, verified | `engine/engineer/intake/ledger.ts:122-223`; callers `engineer-cli.ts:686,1035,1087,1252,1286,1330,1431` |
| 6 | `loop_halt` — the terminal halt event — is declared `persist: false` and **never reaches `.pipeline/events.jsonl`**, the artifact CLAUDE.md and the event-spine skill both name as the one spine. | observability | 95%, verified | `engine/event-sinks.ts:58`; `engine/event-persister.ts:60-63` |
| 7 | The audit sink that *does* capture `loop_halt` is a second, differently-shaped channel (`AuditRecord`, fields `event`/`cause` not `type`/`reason`) — the event-spine skill's own named anti-pattern — and its translation hardcodes `step: 'build'` for **every** halt, so the one durable record is wrong for any halt outside BUILD. | observability | 92%, verified | `engine/audit-trail.ts:42-63,118-170` (`:146`) |
| 8 | `rebase_conflict_halt` is declared `{render:false, persist:false, audit:false}` — a named halt condition reaching **no sink at all**. Its only trace is free text in `.pipeline/HALT`. | observability | 90%, verified | `engine/event-sinks.ts:66` |
| 9 | `writeHaltMarker` is best-effort: it `return`s early on any non-`ENOENT` unlink error of the sidecar and swallows write failures, with no event and no retry — the daemon then advances past a condition that should have parked the feature, and the alerting mechanism's own failure produces zero signal. | observability, data-integrity, architecture | 90%, verified | `engine/halt-marker.ts:45-67` (`:54-58`) |
| 10 | The founding ADR is `Status: Accepted`, never superseded, and decides *"No custom runtime"* — over a repository that is now 106,564 LOC of custom runtime across 325 modules. No record references or supersedes it. | architecture | 95%, verified | `.docs/decisions/001-harness-architecture.md:4,19-20` vs `src/conductor/src/` |
| 11 | `Conductor.run()` is a **single ~5,000-line method** (`:3327-8326`) in a 9,930-line file, on a class with 91 imports, 62 methods, and 55 fields. 134 of 432 ADRs cite this file, many by now-meaningless line number. | architecture | 99%, verified | `engine/conductor.ts:1215`, `:3327-8326` |
| 12 | Value-level (not type-only) circular dependency across the `engine ↔ execution` boundary: `plugin-loader.ts` imports the concrete provider **classes**, which import `validateSpawnPermit` back from `engine/provider-runtime.js`, which imports back into `execution/`. | architecture | 95%, verified | `engine/plugin-loader.ts:6-7` → `execution/{claude,codex}-provider.ts` → `engine/provider-runtime.ts:1-10` |
| 13 | `vitest` 2.1.9 in both packages carries GHSA-5xrq-8626-4rwp (CVSS 9.8, arbitrary file read/exec via the UI server, <3.2.6). **Dev-only; no committed script passes `--ui`** — real but the lowest-cost critical in this report. | dependencies | 100%, verified | `src/conductor/package.json`, `plugins/recorder-provider/package.json` |

---

## Systemic Patterns

Five patterns were evaluated against the evidence. All five are **confirmed**; none were rejected,
but two are materially refined from how their source reports framed them.

| # | Pattern | Specialists | Impact | Recommendation |
|---|---------|-------------|--------|----------------|
| **S1** | **"The correct idiom exists elsewhere in this repo and was not applied here."** This is the single most-corroborated finding in the assessment and the root cause of the majority of criticals. Instances: argv-passing (`session-hook-assets.ts:83,137`) correct, `git-hook-assets.ts:232-241` not; corrupt-file quarantine (`halt-issues/ledger.ts:113-134`) correct, `intake/ledger.ts:95-102` not; fail-closed corrupt-state read (`state.ts:44-52`) correct, `intake/ledger.ts` not; a lease mutex (`conduct-state-lease.ts:163-267`, which data-integrity calls "the strongest concurrency primitive in the codebase" and found no defect in) exists and is **unused by the ledger that most needs it**; a lost-update regression test exists for `conduct-state.json` and `memory-store.ts` but not for the intake ledger; a single shared parser (`wired-into.ts:18`) is correct for `Wired-into:` but `**Story:**` has 3 implementations with 2 divergent regexes; a single `gh` entry point (`tracker-client.ts`) is correct but git has 4 competing port shapes plus 16 files calling `execa('git')` raw; `EVENT_SINKS` proves exhaustiveness-by-type-system for events but step `enforcement` still has two disagreeing sources of truth. | security, data-integrity, testing, duplication, architecture | **Critical.** Directly produces criticals #3, #4, #5. This is a diffusion problem, not a knowledge problem — the fix pattern is always already in the tree. | For each pair, don't just fix the site — delete the second implementation and make the correct one importable. Where that's not practical, add the integrity check that detects a second implementation (this repo already writes checks like this). |
| **S2** | **Silent failure is the default error policy at the exact points where the operator most needs signal.** `catch {}` / `.catch(() => {})` at 35 sites in `src/conductor/src` (60%, inferred — not individually triaged); every `events.jsonl` reader silently drops unparseable lines with no count or diagnostic; `loadStore` returns `{}` on corruption; `kickback-ledger.ts:67-88` fails open on corruption, converting a corruption event into an unbounded rework loop; `writeHaltMarker` swallows; and in bash, the `2>/dev/null \|\| echo` idiom appears at 7+ sites in `bin/conduct` — the same idiom that hides critical #2's injection while the injected code runs. | observability, data-integrity, security | **Critical.** Multiplies every other defect: each of these turns a loud failure into an overnight silent one, which is precisely this system's worst failure shape. | Establish a repo rule with machinery behind it: a swallowed error must emit *something* on the spine. Start with the three highest-value sites (halt-marker, event-persister reader drop-count, intake loadStore) rather than a 35-site sweep. |
| **S3** | **"Never add a parallel channel" is winning at the schema level and losing at the file level — and the cost is now concrete, not aesthetic.** Nobody has forked `ConductorEvent`. But ~40 bespoke `.pipeline/` sidecars with per-file formats and readers, an `mtime`-as-gate-input mechanism complete with a 2-second fudge constant (`artifacts.ts:335-342,379`) — the exact case the event-spine skill's own description names verbatim — a regex-parsed markdown interchange contract across 11 files, and `audit-trail/events.jsonl` in a second schema together constitute the untyped second control plane the rule exists to prevent, assembled one individually-defensible file at a time. **The refinement:** observability supplies the proof that this is not a purity complaint — because the halt lives in the parallel channel and not the spine, answering "why did this halt" requires reading three files in two schemas, and one of them attributes the step wrongly. | architecture, observability, data-integrity | **Critical** (via #6-#8). | Do not attempt a 40-sidecar migration. Do the halt path first (it is the one with a demonstrated cost), then apply the event-spine skill's schema-not-file test as a gate on *new* sidecars so the count stops growing. |
| **S4** | **The repo's own first design principle — "Deterministic where possible; LLM only where necessary" — is applied reactively but not proactively, and CLAUDE.md says so itself.** CLAUDE.md declares 5 Daemon Operations Safety rules as prose-only interim guards "until that machinery exists"; architecture verified **5 of 5 remain prose** (99%, verified). Each documents a failure that already destroyed state (74 worktrees deleted by a zsh-incompatible `mapfile` guard; false `no_task_progress` stalls from a lost evidence sidecar; a feature re-dispatched forever). Independent corroboration: infrastructure found the bulk-delete guard is still prose; data-integrity searched for a worktree-recreate evidence backfill and found none (`task-evidence.ts:74-113` returns empty state on a missing file — the documented #497 stall, unmitigated); devex found harness validation is a *prompted* manual step, not a hook. **Partial credit where earned:** CLAUDE.md rule #4 (#438, manual PR ≠ finish) now *does* have machinery — content-aware shipped-work dedup off the base-branch tree (`daemon-backlog.ts:790-882`, 85% verified). | architecture, infrastructure, data-integrity, devex | **Important-to-critical.** Every one of these five is a recurrence-prone incident with a known, already-experienced cost. | Pick the two with the worst realized cost — the bulk-delete guard and the evidence backfill — and build machinery for them. Both are small (a guarded delete wrapper; a recreate-time backfill from `Task:` commit trailers, which the runbook already documents as reconstructable). |
| **S5** | **The intake pipeline is simultaneously the least-defended subsystem and the only untrusted-input path.** Five specialists land on it independently: it holds 2 of the 13 criticals (no locking, silent wipe), the testing critical (neither failure mode covered), duplication cluster 1 (4 ledgers hand-rolling read/write, `authored-ledger.ts:126` non-atomic), the untrusted-issue-text injection path with no inbound boundary, and a queue whose `claim()` **throws on the first unparseable envelope before any claim rename**, permanently poisoning the head of the queue and stopping the whole inbox from draining (`intake/queue.ts:105-123`, 92% verified) — fed by a non-atomic `enqueue` that writes with plain truncating `writeFile` into the directory `claim()` scans (`:87-92`). | data-integrity, testing, duplication, security, architecture | **Critical.** Failures here are silent, run unattended overnight, cost real money (duplicate spec PRs), and land on the one path an outside party can influence. | Treat intake as one work item, not five. Hardening it addresses more criticals per unit of effort than anything else in this report. |

**Not elevated to systemic, but recorded:** CI/workflow supply-chain hygiene (security's untrusted-head
checkouts and `secrets: inherit`; infrastructure's tag-pinned actions and missing `concurrency:`
groups; dependencies' `lycheeverse/lychee-action@v2`). Three specialists touch it, but every
individual finding is important-or-below and the fixes are independent one-liners — it is handled as
quick wins rather than as a pattern requiring structural response.

---

## Prioritized Roadmap

Ordered by **expected cost to this operator**, not by generic severity. Effort estimates are honest
and include verification, not just the edit.

1. **Harden the intake pipeline as a single work item.** *(~1-2 days)*
   Four sub-tasks, in this order: (a) make `loadStore` distinguish absent from corrupt and quarantine
   to `ledger.json.corrupt-<ts>` — copy `halt-issues/ledger.ts:113-134` verbatim; (b) put the ledger
   behind `conduct-state-lease.ts`'s existing directory-mutex primitive, or a compare-and-set on a
   version field, and make `known()`+`record()` a single atomic operation to close the TOCTOU;
   (c) write the two missing tests — malformed JSON on disk before the first `record()`, and two
   concurrent `record()`/`transition()` calls racing — both of which have working models elsewhere in
   this suite; (d) make `intake/queue.ts:105-123` quarantine a corrupt envelope instead of throwing
   before the claim rename, and make `enqueue` tmp+rename.
   *Why first:* it is the only place where a defect is silent, unattended, financially costly
   (duplicate spec PRs and duplicate builds), untested, and on the untrusted-input path
   simultaneously. It closes 3 of 13 criticals plus 4 important findings.
   *Source: cto-data-integrity, cto-testing, cto-duplication.*

2. **Put the halt back on the spine.** *(~half day)*
   Flip `loop_halt` to `persist: true` and `rebase_conflict_halt` to all three sinks
   (`event-sinks.ts:58,66`); fix the hardcoded `step: 'build'` in `audit-trail.ts:146` to carry the
   actual halting step; and add a halt-write-failure signal so `writeHaltMarker`'s own failure is
   observable (`halt-marker.ts:45-67`). Flipping `loop_halt` also revives `cost-rollup.ts:174-177`,
   which currently counts halts from a file the event never reaches and therefore always reports 0.
   *Why second:* highest-frequency cost. Every halt currently costs a morning of three-file, two-schema
   forensics, and the one durable record is wrong for any non-BUILD halt. The fix is mostly flag flips.
   *Source: cto-observability.*

3. **Eliminate the interpreter-interpolation class, and stop masking its failures.** *(~half day)*
   Convert `bin/conduct:515-522` and `:3022-3023` to pass values via `env` and read `os.environ`;
   convert `git-hook-assets.ts:232-241` to `process.argv[1]` exactly as `session-hook-assets.ts:83,137`
   already does. Then add the integrity check that rejects `$VAR` inside `python3 -c` / `node -e` /
   unquoted heredoc bodies in `bin/` and in hook-asset string literals — per this repo's own design
   principle, the durable fix is the check, not the three edits. While in `bin/conduct`, remove the
   `2>/dev/null || echo` masking at the sites that hide parse failures.
   *Why third and not first:* against the actual threat model these are robustness bugs, not a
   privilege boundary (see framing above) — but they are cheap, they fix a live correctness defect,
   and the integrity check prevents recurrence.
   *Source: cto-security.*

4. **Supersede `001-harness-architecture.md` with an ADR describing the runtime that actually exists.** *(~1 hour)*
   The supersession mechanism in this corpus is excellent (24/24 bidirectional) — it was simply never
   applied to the one decision that matters most. Right now the corpus's root record tells every new
   reader, human or agent, the opposite of the truth. While there, mark `mechanical` in
   `EnforcementLevel` (`types/steps.ts:44`) as dead or use it.
   *Why here:* an hour of work that removes a standing source of agent misdirection. It is only below
   the first three because it corrupts understanding rather than state.
   *Source: cto-architecture.*

5. **Close the CI/workflow supply-chain gaps.** *(~2 hours total, all independent)*
   `persist-credentials: false` on the untrusted-head checkouts (`release-metadata.yml:21-23`,
   `shipped-record.yml:17-19` — `release-pr.yml:27` already shows the pattern); replace
   `secrets: inherit` (`release.yml:125`) with an explicit single-secret mapping; move
   `CLAUDE_CODE_OAUTH_TOKEN` off job-level `env` so it isn't in scope during unpinned global npm
   installs (`live-daemon-e2e.yml:25-26,53`); run `ci-detect-docs-only.sh` from the **base** ref and
   make `ci-gate` treat `skipped` as not-passing (`ci.yml:27,131-153`) — today a PR that edits that
   script to print `docs_only=true` skips integrity, shellcheck, lint, typecheck and conductor while
   `ci-gate` still reports success; quote `for b in $branches` in `block-destructive-git.sh:67` and
   make its payload-parse failure fail closed instead of open.
   *Source: cto-security, cto-infrastructure.*

6. **Dependency remediation, in three separately-shaped moves.** *(js-yaml 5 min; OTel ~half day; vitest ~1 day)*
   `npm update js-yaml` picks up 4.3.1 within the existing `^4.1.0` range and closes the one **prod**
   CVE with no manifest change. The `@opentelemetry/*` cluster (9 packages) must move as one atomic
   commit (0.57.x→0.221.x and 1.30.x→2.10.x together) — never bump a subset. `vitest` 2→4 is a real
   migration that resolves the one critical plus five transitive dev-chain CVEs; treat it as a
   migration with full suite verification, not a drive-by. `uuid` 10→14 is hygiene: confirm first
   whether any call site passes a caller-supplied `buf` to v3/v5/v6 (dependencies rates reachability
   at only ~55% — **tentative**).
   *Source: cto-dependencies.*

7. **Add a correlation id to the event schema.** *(~1-2 days)*
   `ConductorEvent` has no `runId`/`featureSlug`/`sessionId` on its base type; ADR-014 concedes this
   and the OTel exporter invents `conductor.run.id` for its own span tree and never writes it back.
   Consequence: `events.jsonl` ↔ `daemon.log` ↔ `audit-trail` ↔ provider transcripts cannot be joined
   by any shared key, and feature identity is carried by *file path* — which is destroyed by the
   worktree deletion CLAUDE.md documents as an already-occurred failure mode.
   *Why here:* it does not fix a defect, it fixes the cost of diagnosing every future one. Pairs
   naturally with item 2.
   *Source: cto-observability.*

8. **Collapse the git access surface to one seam.** *(~2-3 days)*
   Four competing `GitRunner` port shapes (`rebase.ts:33`, `pr-labels.ts:28`, `setup-triage.ts:23`,
   `shipped-record-on-main.ts:1`, two of which export a type named `GitResult`), 7 files bypassing the
   port entirely for raw `child_process`, and 16 files / 50 call sites invoking `execa('git')` directly
   with per-site error policy. No behavioral divergence was confirmed — duplication rates that
   sub-claim at 75% from a 5-of-16 sample and marks it **tentative** — so this is a
   future-edit-cost fix, not a bug fix. But git is the system's primary side-effect boundary, and
   today there is no single point at which it can be faked, throttled, retried, or audited.
   *Source: cto-architecture, cto-duplication.*

9. **Give the plan/story markdown contract one parser.** *(~2-4 hours)*
   Three `**Story:**` implementations with two divergent whitespace classes
   (`coherence-validator.ts:458,:702`, `artifacts.ts:3578`) and three copies of the `**Stories:**`
   regex (`shipment-audit.ts:614`, `shipped-record-cli.ts:77`, `daemon-backlog.ts:1263-1280`). The
   target shape already exists: `wired-into.ts` exports one regex and one parser imported by three
   modules. Note this is not abstract — the operator's own recorded lessons include three separate
   incidents of plan-header-shape violations that failed late, at land time.
   *Source: cto-duplication, cto-architecture.*

10. **Make `steps.ts` the single source of truth for everything step-shaped.** *(~1 hour for the check; ~half day for generation)*
    Step `enforcement` is declared in `engine/steps.ts` (engine-authoritative) *and* in
    `skills/*/SKILL.md` frontmatter, with **5 verified mismatches** (`memory`, `architecture_diagram`,
    `architecture_review`, `assess`, `remediate` — all advisory-vs-gating). Today it is documentation
    drift because `skill-resolver.ts:92` returns the step definition's value for built-ins; it becomes
    load-bearing the moment a project configures `steps.<name>.skill`, because `:78-80` then lets
    frontmatter win for any step outside the 5-of-26 `ENFORCEMENT_LOCKED_STEPS`. The cheap fix is an
    integrity check comparing the two (this is check-5b's exact shape, already written for the model
    table). This is the same dual-source-of-truth failure `adr-2026-07-26` solved for events.
    *Source: cto-architecture.*

11. **Bound worktree disk growth.** *(~half day)*
    Each worktree's `src/conductor/node_modules` is a **full recursive `cp -a`** (`bin/setup:27-41`),
    plausibly hundreds of MB each, with no disk-space check gating worktree creation and no cap on
    concurrent worktree count — against this repo's own documented history of ~74 concurrent worktrees.
    Hardlink or share the store, or add a pre-create free-space gate. Also add the missing runbook
    section: no runbook covers reclaiming space safely.
    *Source: cto-infrastructure.*

12. **Begin decomposing `Conductor.run()` — incrementally.** *(multi-week; do not attempt as one change)*
    A ~5,000-line method in a 9,930-line file cited by 134 ADRs. Extract at natural step boundaries,
    one step-runner at a time, behind the existing tests. Deliberately last: it is the largest
    structural defect in the report and also the one with the worst change-risk-to-benefit ratio while
    a live daemon self-hosts against this code. Every item above buys more safety per hour.
    *Source: cto-architecture.*

**Explicitly deprioritized, with reasoning:** the DECIDE-grant self-authorization path
(`cli.ts:328-341` + a regex-allowlist write-fence that lets `python3 -c`, `perl -pi`, `node -e`,
`truncate`, `ln -sf` through — `write-fence.ts:80-115`, 92% verified) is a real bypass, but the
principal is the operator's own agent, and the fence does not exist at all for non-self-host builds
today. Fix the fence's allowlist when convenient; do not treat it as a boundary. Likewise the
owner-gate failing open (`owner-gate/gate.ts:14-19`) is correct-enough for a solo repo and becomes a
genuine gap only when a second contributor can merge.

---

## Quick Wins

Each is under an hour, low risk, independent, and fixes something real.

- [ ] `npm update js-yaml` in `src/conductor` — 4.3.1 is already inside the declared `^4.1.0` range and closes the only **prod** CVE in the audit (GHSA-5p4m-2wfm-xmqj). Lockfile-only change. — *cto-dependencies*
- [ ] Flip `loop_halt` to `persist: true` in `engine/event-sinks.ts:58` — one word; puts the terminal halt on the documented spine and revives the dead halt counter in `cost-rollup.ts:174-177`. — *cto-observability*
- [ ] Flip `rebase_conflict_halt` to render/persist/audit in `engine/event-sinks.ts:66` — currently a named halt condition with zero telemetry anywhere. — *cto-observability*
- [ ] Fix `audit-trail.ts:146`'s hardcoded `step: 'build'` so the one durable halt record names the step that actually halted. — *cto-observability*
- [ ] Supersede `.docs/decisions/001-harness-architecture.md` with an ADR describing the 106k-LOC runtime that exists. The mechanism is proven (24/24 bidirectional); it just needs invoking. — *cto-architecture*
- [ ] `persist-credentials: false` on `release-metadata.yml:21-23` and `shipped-record.yml:17-19` — `release-pr.yml:27` already does it. — *cto-security*
- [ ] Replace `secrets: inherit` at `release.yml:125` with the one secret the reusable workflow needs. — *cto-security*
- [ ] Quote the loop at `hooks/claude/block-destructive-git.sh:67` (`for b in "$branches"` → proper array/read) and make the payload-parse failure at line 13 fail closed instead of `|| echo ""`. — *cto-security*
- [ ] Make `engineer/authored-ledger.ts:126` write tmp+rename like its three sibling ledgers do — it is the one of four that dropped atomicity, with no justification in the code. — *cto-duplication*
- [ ] Import `HALT_MARKER`/`HALT_CLASS_MARKER` in `engine/daemon-runner.ts:678-679` instead of hardcoding the paths — the same file already imports `writeHaltMarker` one line above. 2 lines. — *cto-duplication*
- [ ] Add `concurrency:` groups to the 5 non-release workflows (`ci.yml`, `shipped-record.yml`, `intake-label-sync.yml`, `release-metadata.yml`, `live-daemon-e2e.yml`) — pure Actions-minutes savings on every force-push. — *cto-infrastructure*
- [ ] Fix `bin/conduct:4-17`'s header usage comment, which demonstrates a bare-string invocation form the current CLI explicitly rejects — an agent reading source instead of docs learns a superseded contract. — *cto-devex*
- [ ] Add integrity check 5c: compare `engine/steps.ts` `enforcement` against `skills/*/SKILL.md` frontmatter and fail on mismatch (5 exist today). Same shape as the existing model-table drift check. — *cto-architecture*

---

## Strengths — protect these; do not let them regress

This section is not politeness. Each item below was verified by a specialist, several are load-bearing
for the "NEEDS_WORK not worse" verdicts in their own areas, and a regression in any of them would be a
larger loss than most of the findings above.

- **`EVENT_SINKS` exhaustiveness** (`engine/event-sinks.ts:9`) — a compile-time-total
  `Record<ConductorEvent['type'], SinkDeclaration>`. This is the repo's own design principle executed
  correctly, and it is the template for fixing the step-enforcement dual-source problem. Verified
  fully compliant with its ADR.
- **The AST-based test-execution-policy gate** (`test/structural/test-execution-policy.test.ts`) —
  walks every non-smoke test file with the TypeScript compiler API and fails the build on a static
  call to `claude`/`codex`/`curl`/`npm install`/networked `gh`. Machinery, not a rule. (Its one
  acknowledged gap — dynamically assembled argv evades it — is compensated only by prose, which is
  worth a follow-up but does not diminish what exists.)
- **`conduct-state-lease.ts:163-267`** — directory-`mkdir` mutex, `wx` owner file, liveness-proven
  recovery with recovery-claim + quarantine-and-reconfirm, explicit refusal on ambiguous ownership.
  Data-integrity reviewed it in full and **found no defect**. It is the strongest concurrency
  primitive in the codebase — and item 1 above is largely "use it."
- **The `O_EXCL` pidfile mutex and its `transient` marker** (`daemon-lock.ts:713-759`) — kernel-level
  single-winner arbitration; the acquire-unlink-spawn window was reviewed and found sound, not
  defective.
- **Engine versioning** (`scripts/publish-engine.mjs`, `engine-store.ts:288-292,405-453`) —
  immutable `dist-versions/<id>/` + atomic symlink flip, `.publish-incomplete` crash-recovery
  sentinel, content-hash idempotence, and a GC that keeps last-3, **aborts the entire pass with zero
  deletions on any read error**, and carries a self-eviction guard so a daemon cannot GC the version
  it is running. Infrastructure calls this one of the best-engineered surfaces in the repo.
- **Argv-array subprocess discipline** — every `git`/`gh`/provider-CLI call in the engine uses
  `execa`/`execFile` with an argv array. The three `shell: true` sites all execute operator-authored
  config commands, which is the intended contract. The criticals are the *exceptions* to a rule that
  otherwise holds.
- **Outbound secret redaction** — `engineer/intake/sanitize.ts:64-149` (13 high-precision credential
  and PII classes, idempotent, applied at the single filing choke point); `codex-provider.ts:755-774`
  strips every substring of the API key from provider output; `full-suite-evidence.ts:116-154`
  redacts to a fixed point **after** truncation so truncation cannot resurrect a partial secret.
  **No hardcoded credential exists anywhere in the tree** (verified by targeted grep).
- **Centralized parsers and clients where they exist** — `wired-into.ts` as the single
  `**Wired-into:**` parser imported by three modules; `tracker-client.ts` as the single `gh` entry
  point (duplication checked for `gh` sprawl specifically and found none). These are the proof that
  this codebase consolidates correctly once it has been burned.
- **Fail-safe OpenTelemetry** — off by default, `resolveOtelConfig` never throws, an unreachable
  collector produces a bounded warning rather than a broken build, and the `SpanManager` is
  synchronous and off the hot path. It is genuinely wired, not aspirational scaffolding.
- **Fail-closed reads where they were built** — `state.ts:44-52` (corrupt conduct-state fails closed,
  with an idempotent non-destructive `migrateState`); `gated-snapshot.ts:96,125-131` and
  `daemon-backlog.ts:626-634` (`schemaVersion: 1`, atomic writes, explicit `kind: 'unknown'` on
  mismatch so callers render "state unknown", never "nothing gated"); `halt-issues/ledger.ts:113-134`
  (quarantine-and-warn on corruption).
- **ADR supersession discipline** — 24 of 24 superseded records carry a resolvable successor pointer;
  all 17 unique successors carry a matching `Supersedes:` back-reference. 100% bidirectional. The
  corpus's problem is findability, not integrity.
- **Single-source toolchain pinning** — all 11 workflows resolve Node from
  `src/conductor/.tool-versions`; zero drift between CI, the manifest floor, and the documented local
  requirement.
- **Two-proof worktree teardown** — deletion requires branch ancestry *or* merged-PR head identity,
  never a classification alone; `reclaim-worktree` structurally refuses globs, paths, and lists.
- **Operator-facing documentation fidelity** — every doc-to-code spot check came back exact,
  including a byte-identical CLI rejection string. `docs/quickstart.md`'s "First-run blockers" section
  reproduces five real guard error strings verbatim with recovery steps. The `daemon-triage` skill
  carries a hard per-action approval contract with no batching and no standing consent.
- **Content-aware shipped-work dedup** (`daemon-backlog.ts:790-882`, `shipment-audit.ts`) — CLAUDE.md
  rule #4's documented corruption mode (#438) now has real machinery behind it. This is what S4's fix
  looks like when it lands.

---

## Tentative findings — re-verify before acting

These carry their source specialist's own uncertainty and are **not** confirmed. Acting on them
without re-checking is the failure this section exists to prevent.

| Finding | Source | Stated confidence | What to re-check |
|---|---|---|---|
| `task-cli.ts:85-150` read-modify-write of `task-status.json` loses a row flip under parallel agents | data-integrity | 65%, inferred | No actual concurrent call site was traced; the engine does emit `parallel_started`/`parallel_completed`, so co-occurrence is plausible but unproven |
| `daemon-lock.ts:260-272` recycled-pid keeps a dead daemon's lock alive forever | data-integrity | 70%, verified code / inferred impact | The conservative bias is deliberate and documented; the per-boot `uuid` exists but is unused in the liveness decision |
| `uuid` 10→14 CVE is reachable in this codebase | dependencies | ~55%, inferred | Whether any of the 7 call sites passes a caller-supplied `buf` to v3/v5/v6 |
| OTel cluster forward-skew risk on independent bumps | dependencies | ~75%, inferred | Currently internally consistent (verified); the risk is about future PRs |
| "No ADR exists for the `.pipeline/` control plane / git port fork / plan-markdown schema / mtime mechanism" | architecture | 85%, inferred | Negative claims over a 432-record corpus that was not read exhaustively |
| The determinism-trajectory judgement in §6.4 | architecture | 80%, inferred | Explicitly a judgement about trajectory, not an observation |
| Line-number citation rot generalizes beyond the one verified record | architecture | verified for 1 of 134 | Only `adr-2026-07-26-event-sink-registry-exhaustiveness` was re-checked |
| 35 empty-catch sites each represent a real diagnostic loss | observability | 60%, inferred from grep | Not individually traced; treat 35 as a lower bound on locations, not a count of defects |
| Provider transcripts have no joining id to `events.jsonl` | observability | 60%, inferred | Provider-side transcript storage format was not traced |
| OTel is the one consumer that sees a halt live | observability | 65%, inferred | Whether `SpanManager` registers a handler for `loop_halt`/`rebase_conflict_halt` specifically |
| Lifecycle-transition suppression in `daemon-log.ts:87-110` hides a restart loop | observability | 55%, inferred | Mechanism confirmed; no real diagnostic miss observed |
| `sendNotification` is wired to the halt path | observability | 55%, inferred | Single grep hit, no call-site trace |
| No `git` invocation divergence exists across the 16 raw-`execa` files | duplication | 75%, 5-of-16 sample | The "no divergence found" sub-claim, not the call-site count |
| `mkdtemp` fixture boilerplate is duplicated across ~499 test files | duplication | tentative | Individual setup blocks were not diffed; may be genuinely different fixture shapes |
| No engine rollback CLI verb exists | infrastructure | tentative, inferred from absence | Not an exhaustive subcommand grep |
| No `.git/hooks` wiring for `test_harness_integrity.sh` | devex | 80%, half inferred | `.git/hooks` was not grepped directly |
| `slowTestThreshold=1800000` was raised to silence a known-slow outlier | testing | 70%, inferred | The value is verified; the *reason* is not — no commit message or config comment confirms it |
| Node 20.x EOL timing | dependencies | inferred, tentative | Not checked against a live release schedule |
| **Coverage gaps, not clean results:** package abandonment / last-publish dates; install-time deprecation warnings; a suite-wide test coverage percentage; a full source↔test cross-reference | dependencies, testing | not performed | Do not read absence of findings as absence of problems in these four areas |

---

## Verdict: CRITICAL

Reached against the definition, not by counting alone. The bar is *"critical findings exist **OR** 3+
systemic patterns at important+ severity."* **Both arms are independently satisfied:**

- **13 distinct critical defects** across six specialist areas (14 critical-labeled rows; the testing
  critical collapses into the two intake-ledger criticals). The first arm alone is dispositive.
- **Five systemic patterns**, all at important-or-above, three of them producing criticals directly
  (S1 → #3/#4/#5; S3 → #6/#7/#8; S5 → #4/#5). The second arm is satisfied with margin.

**But read the verdict correctly.** CRITICAL here does **not** mean "the system is broken" — the
daemon demonstrably ships features, the engineering in the surfaces listed under Strengths is better
than most codebases of this size achieve, and several specialists raised their own verdicts on
corrected evidence that made the repo look *better*, not worse. What CRITICAL means is:

1. There is a store this system depends on for correctness (the intake ledger) with no locking, no
   corruption handling, and no test for either — in a system whose defining operating mode is
   unattended overnight execution. That is a matter of when, not whether.
2. The system's own documented diagnostic procedure ("check `.pipeline/events.jsonl`") cannot answer
   the one question it exists to answer, for the one event class that matters most.
3. The dominant root cause is not missing knowledge — it is un-diffused knowledge. In nearly every
   critical, the correct implementation is already in this repository, thirty lines away in a sibling
   module. That is the good news and the reason the roadmap above is measured in days, not quarters:
   this is not a rewrite, it is applying what is already here to the places that were skipped.

**Recommendation: pause net-new feature work for roughly one week and execute roadmap items 1-5.**
That closes 8 of the 13 criticals, three of the five systemic patterns, and every quick win. Items
6-12 can then proceed alongside normal feature work.

---

## Specialist Reports

| Area | Agent | Verdict | Critical | Report |
|------|-------|---------|----------|--------|
| Security | cto-security | NEEDS_WORK | 3 | [cto-security.md](../assessments/2026-08-10/cto-security.md) |
| Data Integrity | cto-data-integrity | NEEDS_WORK | 2 | [cto-data-integrity.md](../assessments/2026-08-10/cto-data-integrity.md) |
| Dependencies | cto-dependencies | NEEDS_WORK | 1 (dev-only) | [cto-dependencies.md](../assessments/2026-08-10/cto-dependencies.md) |
| Architecture | cto-architecture | CRITICAL | 3 | [cto-architecture.md](../assessments/2026-08-10/cto-architecture.md) |
| Duplication | cto-duplication | NEEDS_WORK | 0 (1 near-critical) | [cto-duplication.md](../assessments/2026-08-10/cto-duplication.md) |
| Testing | cto-testing | NEEDS_WORK | 1 | [cto-testing.md](../assessments/2026-08-10/cto-testing.md) |
| Infrastructure | cto-infrastructure | NEEDS_WORK | 0 | [cto-infrastructure.md](../assessments/2026-08-10/cto-infrastructure.md) |
| Observability | cto-observability | CRITICAL | 4 | [cto-observability.md](../assessments/2026-08-10/cto-observability.md) |
| Developer Experience | cto-devex | NEEDS_WORK | 0 | [cto-devex.md](../assessments/2026-08-10/cto-devex.md) |

*Two specialists returned CRITICAL independently (architecture, observability). Neither saw the
other's report.*
