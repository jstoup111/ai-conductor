# Coherence: The engine cannot detect its own spinning

**Date:** 2026-08-17
**Tier:** M — technical track (no PRD, so the `fr` row class is omitted as not applicable)
**Plan stem:** `the-engine-cannot-detect-its-own-spinning-operator`
**Outcome source:** `.pipeline/intake-outcomes.md` (`Source-Ref: jstoup111/ai-conductor#1652`)

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2, story-3, story-6 | covered (scoped) | "The engine detects, during a build, that review/suite rounds are repeating rather than converging — at minimum: (a) the same test file or finding site failing N times across rounds, (b) finding substance recurring across laps under drifted keys, (c) kickback rate over a window — and halts needs-human with a rendered diagnosis instead of running to a cap." Delivered as a measured replacement for (a): story-1 counts per-rubric failures in durable state, story-2 fixes the key and blocks the cache-re-stamp miscount, story-3 halts needs-human, story-6 makes the signal readable off the spine. Sub-clause (a) as literally written — per-site repetition — was built and withdrawn on evidence: over 11 features it fired on 2 of the 5 that spun and missed `finish-publication`, the episode this issue reports. Per-rubric repetition fires on 5 of 5 spinning features and 0 of 6 healthy ones. (b) is jstoup111/ai-conductor#1611's territory, spec landed and unimplemented; (c) is forbidden by `adr-2026-07-10-intra-step-build-progress-events` and is not reproducible run-to-run. Both exclusions are recorded in the ADR's Alternatives and conflict-check Conflicts 1 and 4. |
| outcome | outcome-2 | story-4 | covered | "The halt names what repeated, so the operator rules on substance immediately rather than reconstructing it from logs." Story 4 renders rubric, failure count, the sites that rubric most recently flagged, and budget state into the new halt AND into the existing cumulative-cap halt, so the diagnosis ships on the cap path too — which matters because that cap fired on only 2 of 11 features and this bound stays silent on 6 of 11. Its negative paths forbid the body asserting any conclusion the tally did not establish, and forbid the reported sites being counted. |
| outcome | outcome-3 | story-2, story-5 | covered | "A genuinely converging build (new sites each lap, findings resolving) is never interrupted by the detector." Measured directly: at the chosen threshold no healthy feature in the corpus trips, and the earlier site key is rejected partly because sites moving between laps IS convergence. Story 2 keeps cache re-stamps, accepted findings, and infrastructure failures from advancing the tally; story-5's config gate, default-on with fail-closed validation, is the production escape. |
| adr | adr-2026-08-17-build-review-rubric-repetition-short-circuit | story-1, story-2, story-3, story-4, story-5, story-6 | covered | D1 (per-rubric tally on the ledger entry, legacy tolerance, bounded by the four-rubric registry) to story-1; D2 (the rubric is the key, chosen on measured separation over site and consecutive-run variants) and D3 (tick on consumption from the current lap's join, never a lap scan) to story-2; D4 (threshold 4, needs-human) and D6 (ordering after the fresh-base disposition and after the cap) to story-3; D7 (both convergence halts render what repeated; sites reported, never counted) to story-4; D5 (PASS-reset semantics unchanged, verified by a twin sweep) to story-1 and story-5; D8 (`rubricFailures` on the existing `kickback` event, no new variant) to story-6; D9 (build_review only, and the two operator directions) scopes all six. |
| story | story-1 | task-2, task-3, task-7 | covered | Task 2 is RED for tally advance, non-consecutive counting, field isolation, and PASS reset; task 3 adds `rubricFailures` and the bump; task 7 covers accepted findings, infrastructure failures, and legacy entries. |
| story | story-2 | task-4, task-5, task-6 | covered | Task 4 is RED for registry-driven derivation from the effective verdict and for prose-freedom; task 5 implements the pure derivation with its exclusions; task 6 pins that cache re-stamps never tick, that no module derives counts by enumerating lap directories, and that the tally never reaches identity or immunity paths. |
| story | story-3 | task-8, task-9, task-10, task-11 | covered | Task 8 derives the FAIL block's exit set by grep at the tree, discharging review condition C1; task 9 implements the predicate and replays the historical corpus as a test; task 10 wires the exit after the cap and reuses the exact halt sequence; task 11 pins cap-precedence, the discarded stale-base lap, the all-accepted lap, and the re-kick-sweep classification. |
| story | story-4 | task-12, task-13 | covered | Task 12 is RED for both halt bodies, the empty-tally degradation, and sites-reported-not-counted; task 13 implements the bounded, evidence-only renderer discharging review condition C5. |
| story | story-5 | task-1, task-14, task-16 | covered | Task 1 re-derives the threshold in-tree from the corpus and is instructed to halt rather than ship an unsupported number; task 14 adds the gate with fail-closed validation and proves `enabled: false` byte-identical; task 16 documents the key, the default, and the evidence. |
| story | story-6 | task-15 | covered | Task 15 adds the additive optional field to the existing `kickback` member, an explicit persisting sink entry per review condition C3, and a reconstruction test — with no new event variant. |
| task | task-1 | story-5 | covered | `infrastructure`, `Verify-only: yes` — replays the corpus, sweeps thresholds 3–6, confirms the PASS-reset twin sweep, and halts rather than ship a number the data stops supporting. |
| task | task-2 | story-1 | covered | RED for tally advance, non-consecutive counting, `count`/`cumulative` isolation, and PASS reset. |
| task | task-3 | story-1 | covered | GREEN: `rubricFailures` on the gate entry and its bump. |
| task | task-4 | story-2 | covered | RED for registry-driven derivation and for no grader-authored field reaching the counting path. |
| task | task-5 | story-2 | covered | GREEN: pure `contributingRubrics` with accepted-finding and infrastructure-failure exclusions. |
| task | task-6 | story-2 | covered | Cache re-stamps never tick; structural tests forbid lap-directory counting and tally reuse in identity paths. |
| task | task-7 | story-1 | covered | Accepted findings and infrastructure failures do not tick; legacy entries load clean (C4). |
| task | task-8 | story-3 | covered | `infrastructure`, `Verify-only: yes` — the exit set is grep-derived from the tree, not from the plan (C1). |
| task | task-9 | story-3 | covered | The predicate, plus a corpus-replay test asserting every labelled spin feature halts and no healthy one does. |
| task | task-10 | story-3 | covered | The exit is wired after the fresh-base disposition, D2 escalation, budget consumption, and the cap; the halt reuses marker → PR surfacing → central emit (C2). |
| task | task-11 | story-3 | covered | Ordering negatives: cap precedence, discarded stale-base lap, all-accepted lap, re-kick-sweep classification. |
| task | task-12 | story-4 | covered | RED for both halt bodies, empty-tally degradation, and sites reported but not counted. |
| task | task-13 | story-4 | covered | GREEN: bounded, evidence-only renderer on both halt paths (C5). |
| task | task-14 | story-5 | covered | Config gate: absent means on, `enabled: false` byte-identical, invalid threshold fails closed naming the key. |
| task | task-15 | story-6 | covered | `rubricFailures` on the existing `kickback` event, explicit persisting sink entry, reconstruction test (C3). |
| task | task-16 | story-5 | covered | Configuration reference, gates explanation, and stalled-or-stuck runbook updated in the same PR (C6). |

## Scoping statement

outcome-1 is the only row carrying a scoped verdict. Two of its three enumerated signals are excluded
by decisions that predate this feature, and the third is delivered in a measured replacement form
rather than as literally written.

Sub-clause (c) — a kickback rate over a wall-clock window — is **forbidden**, not deferred, and is
recorded as Conflict 1 in the conflict check.

Sub-clause (b) — finding substance recurring under drifted keys — is owned by
jstoup111/ai-conductor#1611, whose spec is landed and unimplemented. Implementing it here would fork
the identity contract that ADR is mid-flight on.

Sub-clause (a) — per-site repetition — was implemented and then withdrawn on measurement rather than
on constraint. This is the substantive scoping decision in the feature and it is recorded in full in
the ADR's Context and Alternatives, in conflict-check Conflict 4, and in the stories' partial-delivery
note. The delivered signal answers the same question the intake was asking; it just answers it with
the key the data supports.

## Assumptions surfaced

**A per-rubric threshold of 4 separates spin from convergence** — 85%, verified over an 11-feature
corpus reconstructed from persisted event ledgers. At 4 the bound fires on 5 of 5 features with
operator-reported or cap-terminated spin and 0 of 6 that converged, avoiding 14 kickbacks. At 3 two
healthy features trip; at 5 one spinning feature is missed. The same sweep run with and without
`cumulative`'s PASS reset gave identical results, which is what licenses leaving `adr-2026-08-12` D2
untouched.

The residual 15% is corpus size and label quality: eleven features is small, and "spin" versus
"healthy" rests on operator reports and cap terminations rather than an independent oracle. Impact if
wrong: too tight and the bound halts converging features, contradicting outcome-3; too loose and it
never pre-empts anything. How to confirm: plan task 1 re-derives the number in-tree and halts rather
than shipping an unsupported one, story-5's gate makes it changeable without a release, and story-6's
persisted tallies keep it checkable against future runs.

This replaces an earlier 55%-confidence assumption behind a per-site threshold, which the same corpus
falsified — the operator directed that the key be fixed to whatever carried real value, and the
measurement is that fix.

**The cumulative cap is not a reliable backstop** — 90%, verified. Across the same corpus the cap
fired on 2 of 11 features although 5 exceeded its nominal threshold, because one `build_review` PASS
resets `cumulative`. This is recorded as motivation for a per-rubric counter, not as a proposal to
change the reset; whether `cumulative` should also carry a never-reset floor belongs to
`adr-2026-08-12`. Impact if wrong: none on this feature — the per-rubric bound stands on its own
measured separation.
