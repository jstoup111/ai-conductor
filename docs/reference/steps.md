---
title: Steps
parent: Reference
nav_order: 8
---

# Steps

The complete step vocabulary the engine executes: names, order, phase, enforcement, skip rules,
artifacts, and the skill each step dispatches. These names are what `conduct-ts inline --from <step>` accepts.

There are 26 step names: 22 sequential steps in `ALL_STEPS` and 4 out-of-band steps in
`OUT_OF_BAND_STEPS`. `validation` and `build_verification` are step *groups* wrapping existing steps,
not steps themselves — neither can be passed to `--from`.

Tables on this page are source-ordered (the order of `ALL_STEPS`), not alphabetized. The order of that
array *is* the flow.

## Enforcement levels

Enforcement is a property of the engine's step definition, not of the skill's frontmatter. It decides
whether the step can be skipped and whether it can be disabled by config.

| Level | Can be skipped | Can be config-disabled | Used by |
| --- | --- | --- | --- |
| `advisory` | Yes | Yes | `memory`, `explore`, `complexity`, `architecture_diagram`, `architecture_review`, `retro`, and all four out-of-band steps |
| `gating` | No | Only with `configDisableAllowed` | `prd`, `stories`, `conflict_check`, `plan`, `coherence_check`, `acceptance_specs`, `build_review`, `wiring_check`, `test_suite`, `manual_test`, `prd_audit`, `architecture_review_as_built`, `finish` |
| `structural` | No | Never — the flag is ignored entirely | `worktree`, `build`, `rebase` |
| `mechanical` | — | — | Nothing. The level is declared in the type union but no step definition uses it. |

Skippability is exactly `enforcement !== 'gating'`. Tier and track skips (below) are a separate
mechanism and apply to gating steps too. For what a gate *is* and why it fails closed, see
[gates](../explanation/gates.md).

## Sequential steps

The 22 steps of `ALL_STEPS`, in execution order. "Skips" lists tier and track exclusions; see
[Tier skips](#tier-skips) and [Track skips](#track-skips).

| # | Step | Phase | Enforcement | Prerequisites | Skips | Dispatches |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | `worktree` | SETUP | structural | — | — | `/conduct worktree` |
| 1 | `memory` | UNDERSTAND | advisory | — | — | `/memory` |
| 2 | `explore` | DECIDE | advisory | — | — | `/explore` |
| 3 | `complexity` | DECIDE | advisory | `explore` | — | `/conduct complexity` |
| 4 | `prd` | DECIDE | gating | `explore` | track `technical` | `/prd` |
| 5 | `architecture_diagram` | DECIDE | advisory | `complexity` | tier S | `/architecture-diagram` |
| 6 | `architecture_review` | DECIDE | advisory | `architecture_diagram` | tier S | `/architecture-review` |
| 7 | `stories` | DECIDE | gating | `architecture_review` | — | `/stories` |
| 8 | `conflict_check` | DECIDE | gating | `stories` | tier S | `/conflict-check` |
| 9 | `plan` | DECIDE | gating | `conflict_check` | — | `/plan` |
| 10 | `coherence_check` | DECIDE | gating | `plan` | tier S | `/coherence-check` |
| 11 | `acceptance_specs` | BUILD | gating | `plan` | tier S | `/writing-system-tests` |
| 12 | `build` | BUILD | structural | `plan` | — | `/pipeline` |
| 13 | `wiring_check` | BUILD | gating | `build` | — | engine-native |
| 14 | `test_suite` | BUILD | gating | `build` | — | engine-native |
| 15 | `build_review` | BUILD | gating | `wiring_check`, `test_suite` | — | engine-native |
| 16 | `manual_test` | SHIP | gating | `test_suite` | tier S | `/manual-test` |
| 17 | `prd_audit` | SHIP | gating | `manual_test` | track `technical` | `/prd-audit` |
| 18 | `architecture_review_as_built` | SHIP | gating | `prd_audit` | tier S; also when `architecture_review` was skipped | `/architecture-review --as-built` |
| 19 | `retro` | SHIP | advisory | `architecture_review_as_built` | tier S | `/retro` |
| 20 | `rebase` | SHIP | structural | `retro` | — | native; `/rebase` only on conflict |
| 21 | `finish` | SHIP | gating | `rebase` | — | `/finish` |

Per phase: SETUP 1, UNDERSTAND 1, DECIDE 9, BUILD 5, SHIP 6.

Two steps are checkpoints (`isCheckpoint: true`) — the engine pauses for the operator after them in
default and interactive mode: `build` and `manual_test`.

`build` is the first `loopGate` step, which makes index 12 the boundary between the front (DECIDE-ish,
one-way) region and the gate loop. Everything from `build` to `finish` is a loop gate and can be
re-entered when a downstream gate kicks back. The kickback targets — the steps a blocking gate can send
work back to — are `prd`, `architecture_review`, `stories`, and `plan`.

## Repository-local self-host tail

This repository adds two configured SHIP gates without changing the static `ALL_STEPS` index:
`rebase → maintain-documentation → release-disposition → finish`. `release-disposition` is gating,
writes the authoritative structured metadata to the retained SHIP draft PR, and records only its
completion evidence in `.pipeline/release-disposition-pass`. The later `finish` step preserves that
metadata while supplying the reader-facing PR body.

Both configured gates read the **retained SHIP PR**, which the engine adopts at SHIP-phase entry. If
that PR is a reused `needs-remediation` halt placeholder, the engine makes it presentable at
adoption — before the first SHIP-phase step in the resolved registry is dispatched, custom or
built-in — so a SHIP step scheduled ahead of `finish` never reads a remediation placeholder. The
draft→ready flip remains finish-only. See
[running the daemon](../guides/running-the-daemon.md#a-reused-halt-pr-is-made-presentable-at-ship-entry-not-at-finish).

## Out-of-band steps

These have full step definitions and are dispatchable, but hold no slot in the sequential loop.
`--from` cannot start at them; the engine invokes them itself when a condition fires.

| Step | Phase | Enforcement | Prerequisites | Dispatches | When it runs |
| --- | --- | --- | --- | --- | --- |
| `bootstrap` | UNDERSTAND | advisory | — | `/bootstrap` | Prelude, before the loop |
| `assess` | UNDERSTAND | advisory | — | `/assess` | Prelude; short-circuited when `bootstrap_mode` is `new` |
| `remediate` | SHIP | advisory | `prd_audit` | `/remediate` | When a SHIP gate blocks, when `build_review` FAILs on completeness, or on a build stall |
| `attribution_verify` | SHIP | advisory | — | engine-native | Out-of-band commit-attribution audit |

They exist as definitions because `getStepDefinition` throws `Unknown step: <name>` without one, and
the daemon turns that throw into a `.pipeline/HALT`. Config-declared custom steps resolve from a third
table that `buildStepRegistry` populates, consulted after these two — see
[configuration](configuration.md#custom-step-registry-contract).

## The validation group

`validation` is a `StepGroup` over three members already present in `ALL_STEPS`, in this order:
`manual_test`, `prd_audit`, `architecture_review_as_built`. It does not remove, replace, or reorder
them, and it does not change their state keys.

The group only fans out when all of these hold:

1. The step belongs to a group.
2. The run mode is `auto`. Interactive and default mode never engage the group.
3. The entry step's own prerequisite gate passes.
4. More than one member is dispatchable. A width-1 group degrades silently to the serial path.

Fan-out width is capped by the `validation_concurrency` config key (default 4, which covers the
three-member group in a single wave; see
[configuration](configuration.md)). Branches never write `conduct-state.json` or `.pipeline/gates/*` —
only the loop thread does, after every branch settles.

## The build verification group

`build_verification` is a `StepGroup` over two members already present in `ALL_STEPS`: `wiring_check`
and `test_suite`. Both dispatch no skill — each is a deterministic function of the tree — and both list
`build` as their only prerequisite, so they fan out together immediately after `build` and join before
`build_review`. Like `validation`, this is a wrapper: it does not remove, replace, or reorder the
members' own `StepDefinition`s, and it shares the same fan-out mechanics (auto mode only, width-1
degrades to the serial path, capped by `validation_concurrency`, single-writer join).

Because both members are deterministic rather than model-judged, the join classifies a member as failed
whenever its outcome is a no-verdict (other than an auth failure, which parks and retries) or a
passing dispatch whose recomputed gate verdict is not `satisfied` — there is no ambiguous or
partial-credit outcome to reconcile, unlike the SHIP-tail `validation` group.

After a BUILD repair, the next `build_verification` round dispatches every non-skipped member,
including a member with a passing verdict left on disk by an earlier round. A stored verdict is not
membership authority: only the current round's join declares a member satisfied. Each dispatched
member decides its own work from its existing evidence. `wiring_check` re-derives when its recorded
head differs from the current head; `test_suite` reuses a matching content fingerprint or derives a
fresh suite result. Reuse does not consume retry or kickback budget.

## Tier skips

Tier S skips 8 steps. Tiers M and L skip none.

| Tier | Steps skipped |
| --- | --- |
| S | `architecture_diagram`, `architecture_review`, `conflict_check`, `coherence_check`, `acceptance_specs`, `manual_test`, `architecture_review_as_built`, `retro` |
| M | none |
| L | none |

Tier S additionally disengages the land-time coherence gate entirely.

Steps that are **not** tier-skippable at any tier include the whole BUILD spine — `build`,
`build_review`, `wiring_check`, `test_suite` — plus `plan`, `stories`, `prd`, `rebase`, and `finish`.

A skipped step is marked `skipped`, which satisfies downstream prerequisites. The chain never breaks
because of a skip.

## Where the tier comes from

Four separate paths resolve a feature's tier, and each has its own fallback. They are not
reconciled with one another — the path in play decides which fallback you get.

| Path | Where the tier is read | When no tier is found |
| --- | --- | --- |
| Daemon dispatch | `.docs/complexity/<slug>.md` on the base-branch tree, via the `Tier: <S\|M\|L>` line; a dated slug falls back once to the date-stripped stem when that stem is unambiguous | `M` — the daemon's own fallback for an absent or garbled marker, logged once per slug with the paths tried |
| `conduct-ts inline --auto` | The tier already persisted in the run state. No marker read, no prompt, no host dispatch | `L` |
| `conduct-ts inline --interactive`, and the default run mode | The persisted tier, else the `complexity` step's assessment, confirmed by the operator | `L`, when the assessment fails and there is no prompt to fall back on |
| `complexity.default_tier` in `.ai-conductor/config.yml` | Nowhere — the key validates but no engine code reads it | Not applicable; the key never contributes a tier |

The marker file is the only durable carrier. A tier chosen in an interactive run reaches a later
daemon build only if the `complexity` step committed `.docs/complexity/<slug>.md` under the plan stem —
or under its date-stripped form, the one relaxation the daemon allows
([undated-stem fallback](artifacts.md#the-undated-stem-fallback)) — because that file is the only thing
the daemon looks at. To pin a tier for a daemon build, commit the marker — `complexity.default_tier`
will not do it. See [configuration](configuration.md#complexity) for that key's known limitation, and
[artifacts](artifacts.md) for the marker's format.

## Track skips

The track split touches exactly two steps plus one land-gate layer.

| Difference | `product` | `technical` |
| --- | --- | --- |
| `prd` (index 4) | Runs | Skipped — no product requirements to spec |
| `prd_audit` (index 17) | Runs | Skipped — no PRD to audit |
| Land-time coherence `fr` layer | Required | Not required; the layer degrades away |

Everything else is identical on both tracks. The track is decided in `explore` and recorded in
`.docs/track/<slug>.md`, which the daemon reads with the same
[undated-stem fallback](artifacts.md#the-undated-stem-fallback) as the tier marker. A missing track
resolves to `product`, so nothing is track-skipped when the track is unknown.

## Other skip mechanisms

| Mechanism | Rule | Steps affected |
| --- | --- | --- |
| `skipWhenSkipped` | Skip when a named upstream step ended `skipped`, for any reason | `architecture_review_as_built` skips when `architecture_review` did |
| Bootstrap mode | `bootstrap_mode: new` skips the step with a `mode_skip` event | `assess` only |
| `configDisableAllowed` | Opt-in to `steps.<name>.disable: true`. Config validation rejects disabling any other gating or structural built-in | `manual_test` only |
| `when:` | Per-step conditional expression in config | Any configured step |

## Step artifacts and gate behavior

Each step's completion gate reads evidence from disk. The engine recomputes verdicts from that
evidence rather than trusting an agent's self-report. Committed artifacts live under `.docs/`;
uncommitted run evidence lives under `.pipeline/`. See [artifacts](artifacts.md) for file-by-file
detail.

| Step | Evidence | Committed | What satisfies the gate |
| --- | --- | --- | --- |
| `worktree` | — | — | Prerequisites only; no artifact check |
| `memory` | — | — | Prerequisites only |
| `explore` | — | — | Prerequisites only. Notes are ephemeral; the track marker is written but is not a completion glob |
| `complexity` | — | — | Prerequisites only |
| `prd` | `.docs/specs/*.md` | yes | At least one matching file |
| `architecture_diagram` | `.docs/architecture/*.md` | yes | At least one matching file |
| `architecture_review` | `.docs/decisions/architecture-review-*.md`, `.docs/decisions/adr-*.md` | yes | At least one matching file |
| `stories` | `.docs/stories/**/*.md` | yes | At least one matching file. The verdict layer additionally requires this feature's stories doc to carry `### Happy Path` and `### Negative Path(s)` sections, each with at least one Given/When/Then bullet, and no `Status: DRAFT` |
| `conflict_check` | `.docs/conflicts/*.md` | yes | At least one matching file |
| `plan` | `.docs/plans/*.md` | yes | At least one matching file. The verdict layer additionally requires every story unit in this feature's plan to be covered by at least one task, and fails when the feature's plan cannot be resolved among several |
| `coherence_check` | `.docs/coherence/*.md` | yes | At least one matching file, named with the plan's filename stem |
| `acceptance_specs` | spec files in the project's test dirs, plus `.pipeline/acceptance-specs-red.json` | specs yes, evidence no | At least one spec file **and** RED evidence proving the feature's own specs ran and failed. A spec that was skipped, deselected, or hit a collection error does not establish RED |
| `build` | `.pipeline/task-status.json` | no | No `.pipeline/halt-user-input-required` marker, every task completed or skipped, **and** a clean working tree whenever the status probe establishes one. The post-rebase closure applies the same conjunct: a reapplied autostash blocks BUILD until the named paths are committed or discarded. An absent or failed probe fails open to the legacy behavior. Task status is re-seeded and re-derived on each evaluation, so forged rows fail |
| `build_review` | `.pipeline/build-review.json` | no | A fresh, valid `PASS` verdict. Missing, prior-session, malformed, or `FAIL` all block, and a `FAIL` surfaces the grader's reasons into the kickback. The kickback target is derived from the failing rubric item, not fixed at `build` — see [gates](../explanation/gates.md#where-a-build_review-fail-goes) |
| `wiring_check` | `.pipeline/wiring-evidence.json` | no | Validated evidence with non-empty symbols per task. Missing evidence is computed live; evidence recorded at a prior HEAD is re-derived in process rather than rejected |
| `test_suite` | `.pipeline/test-suite-evidence.json` | no | A live re-inspection returning `CURRENT`. File presence alone can never satisfy this gate |
| `manual_test` | `.pipeline/manual-test-results.md` | no | The latest attempt section has no FAIL rows and is fresh. After a recorded FAIL, HEAD must have moved before an all-PASS attempt is accepted |
| `prd_audit` | `.pipeline/prd-audit.md` | no | Fresh audit where every FR row is `ALIGNED` or explicitly `ACCEPTED`. Any `MISSING`, `PARTIAL`, or `DIVERGED` row blocks |
| `architecture_review_as_built` | `.pipeline/architecture-review-as-built.md` | no | A `Verdict:` line reading `APPROVED` or `APPROVED WITH DRIFT NOTES`. `BLOCKED`, missing, or unrecognized all block |
| `retro` | `.docs/retros/*.md` | yes | A retro file matching this feature's slug, fresh this session |
| `rebase` | — | — | Computed from live git state, not a file |
| `finish` | `.pipeline/finish-choice` | no | A fresh final-outcome marker. Interactive intent is acquired by the foreground prompt host before publication; the coordinator writes `pr` or `keep` through `finish-record` only after the corresponding evidence is coherent. Legacy `merge-local` and `discard` markers remain readable but are never synthesized by unattended FINISH |
| `bootstrap`, `remediate`, `attribution_verify` | — | — | No completion glob. `remediate`'s output, `.pipeline/remediation.json`, is read directly by the engine to route |
| `assess` | `.docs/decisions/technical-assessment-*.md` | yes | At least one matching file |

Every predicate is fail-closed: missing, stale, malformed, or non-passing evidence leaves the gate
unsatisfied. Durable verdicts are written to `.pipeline/gates/<step>.json`.

A step the engine resolves by *skipping* never runs its predicate, but it still writes a verdict:
`{"satisfied": true, "reason": "skipped: <cause>"}`. The `skipped: ` prefix marks a gate that was
deliberately not run, so it is never mistaken for evidence that passed. This covers every skip —
tier, track, bootstrap mode, upstream skip, `disable: true`, a false `when:`, the daemon's in-loop
`retro` skip, and an advisory step auto-skipped after a failed completion check (whose reason carries
the failure). It matters most for `retro`, which is advisory, tier-S-skippable, and skipped on every
daemon run: it previously left no verdict at all. See [gates](../explanation/gates.md#what-a-gate-is).

## Starting from a step

`--from <step>` sets the loop's starting index by a linear name lookup over the resolved step
registry:

```bash
conduct-ts inline "<feature description>" --from build
```

Accepted values are the 22 sequential step names above, in underscore form, plus any custom step name
inserted through the `steps` config key. There is no dash normalization in the engine — `--from
conflict-check` is not the same string as `conflict_check`.

> **Known limitation.** `--from` is unvalidated. An unrecognized name resolves to index `-1` with no
> error and no event, and the run proceeds from that index. Check spelling and underscore form before
> relying on it. Tracked in [#1027](https://github.com/jstoup111/ai-conductor/issues/1027).

## Step-to-skill mapping

Dispatch reads a single map keyed by step name. That map is the authority for what a step invokes; the
`skillName` field on the step definition is not consulted at dispatch time.

Four steps dispatch no skill at all and run entirely in the engine: `build_review`, `wiring_check`,
`test_suite`, and `attribution_verify`. Of these, `build_review` and `attribution_verify` dispatch a
one-shot model call from engine code and keep the normal per-step retry budget; `wiring_check` and
`test_suite` are deterministic functions of the tree.

Two steps dispatch the `conduct` skill with an argument rather than a skill of their own name:
`worktree` runs `/conduct worktree` and `complexity` runs `/conduct complexity`.

> **Known limitation.** Two step definitions carry a `skillName` naming a skill directory that does not
> exist: `worktree` declares `skillName: 'worktree'` and `attribution_verify` declares
> `skillName: 'attribution-verify'`. Neither `skills/worktree/` nor `skills/attribution-verify/` is on
> disk. Nothing breaks, because dispatch uses the invocation map and the model table uses its own
> skill-to-step map, but the field misleads anyone reading the step definition. The repository's
> integrity suite validates `/skill-name` references inside SKILL.md files, not `skillName` fields in
> TypeScript, so these are unguarded. Tracked in
> [#1018](https://github.com/jstoup111/ai-conductor/issues/1018).

## Related pages

- [skills](skills.md) — the catalog of skills these steps dispatch.
- [artifacts](artifacts.md) — every `.docs/` artifact and `.pipeline/` state file.
- [gates](../explanation/gates.md) — what a gate is and why it fails closed.
- [sdlc-phases](../explanation/sdlc-phases.md) — why there are five phases, tracks, and tiers.
- [cli](cli.md) — every command and flag, including `--from`.
- [configuration](configuration.md) — disabling steps, custom steps, `validation_concurrency`.
