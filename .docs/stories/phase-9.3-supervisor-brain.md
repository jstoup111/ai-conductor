# Stories: Phase 9.3 — Supervisor / Brain (capstone)

**Status:** Accepted
**Source PRD:** `.docs/specs/2026-06-25-phase-9.3-supervisor-brain.md`
**Complexity tier:** L
**Persona note:** "I" is the **human operator** (James) driving `conduct brain` — bringing ideas,
confirming routing, reviewing/merging spec PRs. The **brain** is the non-autonomous planning
service. Downstream, the **per-project daemon** consumes merged specs (unchanged here). The brain
**consumes read-only** from the 9.1 store and 9.2 registry, and **writes specs only to target
project repos** (branch + PR). It **never builds and never auto-merges** — the merged spec PR is
the single, non-negotiable human approval gate.

---

## Story: `conduct brain` loop starts and loads registry + store

**Requirement:** FR-1
As the operator, I want `conduct brain` to start a session that loads the registry and opens the
brain store, so routing and the flywheel have their inputs from the first idea.

### Acceptance Criteria
#### Happy Path
- Given a populated registry (9.2) and brain store (9.1), when I run `conduct brain`, then it loads
  the registry via the `RegistryReader` and opens the store via the `BrainStoreReader`, reports the
  count of known projects, and enters the interactive loop ready for the first idea.

#### Negative Paths
- Given the registry file is **absent**, when I start `conduct brain`, then it starts with **zero
  known projects** (every idea will route to create-new, FR-4) rather than crashing — and says so.
- Given the brain store is **absent or empty**, when I start, then the flywheel read (FR-5) is a
  **no-op** (no lessons surfaced) and the loop still starts — absence of memory never blocks
  planning.
- Given the registry file exists but is **malformed JSON**, when I start, then it fails fast with a
  clear error naming the file — it does **not** proceed with a silently-empty project list that
  would mis-route every idea.

### Done When
- [ ] `conduct brain` loads registry + store, prints project count, enters the loop.
- [ ] Missing registry → 0 projects, no crash; missing/empty store → flywheel no-op, loop runs.
- [ ] Malformed registry → fast clear error (does not masquerade as "no projects").
- [ ] Test: start with (a) populated, (b) absent, (c) malformed registry; (d) absent store.

---

## Story: Idea intake loop persists context and exits cleanly

**Requirement:** FR-2
As the operator, I want each iteration to accept a free-text idea and keep going until I exit, with
context carried across ideas, so a session is a continuous planning conversation, not one-shot.

### Acceptance Criteria
#### Happy Path
- Given the loop is running, when I enter a feature idea, then it processes that idea (route →
  author → PR) and then **returns to the prompt** for the next idea.
- Given I have processed one idea, when I enter a second, then session context from the first (e.g.
  projects already resolved, lessons already loaded) is **reused**, not reloaded from scratch.
- Given I issue the exit command (e.g. `exit`/EOF), when the loop reads it, then it terminates
  cleanly with exit 0 and a session summary (ideas processed, PRs opened).

#### Negative Paths
- Given an **empty idea** (blank line), when entered, then the loop re-prompts without routing or
  authoring (no empty spec, no branch).
- Given an idea-processing step **throws** (e.g. authoring fails mid-way), when caught, then the
  loop reports the failure for that idea and **returns to the prompt** — one failed idea does not
  kill the whole session.
- Given EOF/`Ctrl-D` on a non-interactive stdin, when read, then the loop exits cleanly (0) rather
  than spinning on a closed stream.

### Done When
- [ ] Loop processes idea → re-prompts; second idea reuses session context; exit → 0 + summary.
- [ ] Blank idea → re-prompt, no side effects; per-idea error is isolated; EOF → clean exit.
- [ ] Test: scripted multi-idea session incl. a blank line and an injected per-idea failure.

---

## Story: Route an idea to a project with mandatory human confirmation

**Requirement:** FR-3
As the operator, I want the brain to propose a target project for my idea and require my
confirmation before it authors anything, so nothing is written to a repo I didn't approve.

### Acceptance Criteria
#### Happy Path
- Given an idea and a registry with candidate projects, when routing runs, then the brain proposes
  **one target project** (inferred from the idea + registry: name/remote/path signals) with a brief
  rationale, and asks me to **confirm or redirect**.
- Given I **confirm**, when confirmation is recorded, then authoring (FR-6) proceeds against that
  project and no other.
- Given I **redirect** to a different registered project, when I pick it, then authoring proceeds
  against the **redirected** project, not the originally proposed one.

#### Negative Paths
- Given a proposed target, when I **decline without choosing** (or send empty confirmation), then
  **no authoring happens** — the brain re-prompts for a target or the next idea. (No "silent yes":
  confirmation must be affirmative.)
- Given I redirect to a name **not in the registry**, when validated, then the brain rejects it and
  re-prompts (it does not invent a path) — unless I explicitly choose create-new (FR-4).
- Given the idea is ambiguous and **multiple projects score similarly**, when proposing, then the
  brain surfaces the top candidates for me to choose rather than silently picking one.

### Done When
- [ ] Proposal shown with rationale; **authoring is gated on affirmative confirmation**.
- [ ] Redirect to a registered project retargets authoring; unknown name → rejected/re-prompt.
- [ ] Decline/empty → no branch, no PR, nothing written to any repo.
- [ ] Test: confirm path, redirect path, decline path (assert **zero** repo writes on decline),
      unknown-redirect path.

---

## Story: Create a new project when none fits, then route to it

**Requirement:** FR-4
As the operator, I want the brain to offer to create a new project when no registered one fits, so a
genuinely new idea isn't forced into the wrong repo.

### Acceptance Criteria
#### Happy Path
- Given an idea with **no fitting registered project**, when routing runs, then the brain offers to
  **create** one; on my confirmation it invokes the 9.2 `create` path (scaffold + register) and then
  routes the idea to the new project for authoring.
- Given the new project is created, when authoring proceeds, then it targets the **newly created**
  repo path from the registry record (not cwd, not a guess).

#### Negative Paths
- Given the create offer, when I **decline** to create, then no project is created and no authoring
  happens for that idea (back to the prompt).
- Given `create` **fails** (e.g. target dir non-empty — 9.2 FR-7), when it errors, then the brain
  reports it and does **not** proceed to author into a non-existent/half-made repo (no orphaned
  branch/PR).
- Given create succeeds but registry write is then unreadable, when re-resolving the target, then
  the brain stops with a clear error rather than authoring into an unregistered path.

### Done When
- [ ] No-fit → create offer; confirm → 9.2 create + register + route to new repo.
- [ ] Decline → nothing created/authored; create failure → no authoring, clear error, no orphans.
- [ ] Test: no-fit→create→author happy path against a real temp dir; create-failure path.

---

## Story: Flywheel — surface relevant prior lessons into planning

**Requirement:** FR-5
As the operator, I want the brain to read the 9.1 store and inject the **relevant** prior lessons
into planning, so each plan benefits from accumulated kickbacks/halts/retry-hotspots/narratives.

### Acceptance Criteria
#### Happy Path
- Given a confirmed target project and a store with signals, when planning context is assembled,
  then the brain selects lessons **relevant** to that project and similar features (per the chosen
  strategy: per-project + keyword/recency) and injects a concise digest (kickbacks, halts,
  retry-hotspots, narrative refs) into the DECIDE planning context.
- Given relevant lessons exist, when the spec is authored, then the digest is **present in the
  authored planning artifact / planning prompt** (observable, not just logged).

#### Negative Paths
- Given the store has signals but **none relevant** to this project/feature, when selecting, then
  the brain injects **nothing** (or an explicit "no prior lessons") rather than padding planning
  with unrelated noise — relevance is enforced, not "dump everything."
- Given a **malformed/partial signal record** (one bad line in `signals.jsonl`), when reading, then
  it is skipped and the rest are used — one corrupt line never aborts the flywheel read.
- Given an enormous store, when selecting, then selection is **bounded** (top-N by the strategy) and
  the bound is logged, so planning context isn't blown out (no silent unbounded inclusion).

### Done When
- [ ] Relevant lessons selected per project + similarity and injected observably into planning.
- [ ] No-relevant → nothing injected; corrupt line skipped; selection bounded + bound logged.
- [ ] Test: seeded store → assert the **specific** relevant lessons appear and irrelevant ones do
      not; corrupt-line fixture; over-cap fixture asserts the cap + log.

---

## Story: Author the spec via DECIDE skills in the target repo on a spec branch

**Requirement:** FR-6
As the operator, I want the brain to author the spec by running the existing DECIDE skills
(brainstorm→stories→plan) in the target repo on a `spec/<feature>` branch, so I review the same
PRD/stories/plan shapes a normal DECIDE phase produces — with no second planning stack.

### Acceptance Criteria
#### Happy Path
- Given a confirmed target repo, when authoring runs, then the brain operates **with that repo as
  cwd/target**, creates a `spec/<feature>` branch off the repo's default branch, runs
  brainstorm→stories→plan, and produces the standard artifacts (`.docs/specs`, `.docs/stories`,
  `.docs/plans`) committed on that branch.
- Given the feature name, when the branch is created, then it is `spec/<slug>` derived from the idea
  (slugified, collision-suffixed if the branch exists).

#### Negative Paths
- Given the target repo has **uncommitted changes** on its current branch, when authoring starts,
  then the brain does **not** silently stash/clobber them — it branches from a clean ref or errors
  clearly, leaving the operator's working tree intact.
- Given the `spec/<feature>` branch **already exists**, when creating, then the brain does not
  force-overwrite it — it suffixes/aborts with a clear message (no lost prior spec work).
- Given a DECIDE sub-step **fails** (e.g. stories gate not met), when caught, then authoring stops
  and reports which step failed; it does **not** open a PR for an incomplete spec.
- Given authoring, when it runs, then **no build/test-implementation step executes** — the brain's
  output is spec artifacts only (assert no source/impl files authored, FR-7/FR-10).

### Done When
- [ ] Authoring targets the chosen repo, branches `spec/<feature>`, runs brainstorm→stories→plan,
      commits standard artifacts.
- [ ] Dirty tree not clobbered; existing branch not force-overwritten; failed DECIDE step → no PR;
      no build/impl output.
- [ ] Test: real temp git repo → assert branch + artifacts exist; dirty-tree path; existing-branch
      path; failed-substep path; assert **no impl files** committed.

---

## Story: Open a spec PR; never build, never auto-merge

**Requirement:** FR-7
As the operator, I want the brain to open a PR with the authored spec and stop there, so my merge is
the approval and nothing ships without me.

### Acceptance Criteria
#### Happy Path
- Given a `spec/<feature>` branch with committed artifacts, when handoff runs, then the brain opens
  a **PR** in the target repo (reusing existing PR machinery), reports the PR URL, and returns to
  the loop.

#### Negative Paths
- Given the PR is opened, when handoff completes, then the brain **does not merge it** — assert no
  `gh pr merge` / merge API call is ever issued by the brain (the merge is the human's act).
- Given the PR is opened, when handoff completes, then the brain **does not run any build/pipeline**
  — there is no transition from "PR opened" to "implementation" inside the brain.
- Given the target repo has **no remote / no GitHub** (e.g. a freshly `create`d local-only repo),
  when handoff runs, then the brain reports that the spec is committed on the branch and a PR could
  not be opened (clear, non-fatal) rather than crashing or silently dropping the work.

### Done When
- [ ] Spec PR opened, URL reported; loop continues.
- [ ] **No merge call** and **no build** issued by the brain under any path (asserted).
- [ ] No-remote repo → branch+artifacts preserved, PR-skip reported clearly.
- [ ] Test: PR-open path (mock/real `gh`); assert-no-merge; assert-no-build; no-remote path.

---

## Story: Brain may launch a daemon detached, but never manages one

**Requirement:** FR-8 (revised per ADR-005 operator refinement)
As the operator, I want the brain to optionally *launch* a project's daemon as a convenience, but
never manage it, so daemons stay independent and fault-isolated.

### Acceptance Criteria
#### Happy Path
- Given a target project, when I ask the brain to start its daemon, then the brain launches it as a
  **detached, fire-and-forget** process and returns to the loop — holding **no** retained handle,
  IPC channel, or supervision over it.
- Given the brain did not ask to launch a daemon, when it finishes an idea, then it takes **no**
  daemon action at all — authoring a spec never implies launching a daemon.

#### Negative Paths
- Given the brain launches a daemon, when it runs end to end, then it **never stops, restarts,
  configures, or supervises** it and **writes no daemon-supervision/control state** — launching ≠
  managing (asserted, not just by omission).
- Given a daemon the brain launched, when the just-authored spec PR is still **unmerged**, then the
  daemon **does not build that feature** — it builds **human-merged specs only**, so launching
  creates **no** autonomous build path (FR-10 holds).
- Given the spec PR is merged later out-of-band, when that happens, then the brain has **no callback
  or watcher** acting on it (the brain takes no further action on that feature; the daemon consumes
  it independently).

### Done When
- [ ] Brain MAY launch a daemon **detached** (no retained handle/IPC, no supervision/control-state
      write); never stops/restarts/configures/supervises one.
- [ ] A brain-launched daemon builds merged specs only — no brain→build path (asserted).
- [ ] No post-merge watcher/callback in the brain.
- [ ] Test: launch → assert detached + no supervision state; assert daemon does not build an unmerged
      spec; idea without launch request → no daemon action.

---

## Story: Read-only governor reporting

**Requirement:** FR-9
As the operator, I want the brain to report aggregate token spend and kickback/halt/retry rates from
the store, so I have a governor view — without it gating or brokering execution.

### Acceptance Criteria
#### Happy Path
- Given a store with signals, when I request the governor report, then the brain computes and prints
  **aggregate** token spend and kickback/halt/retry **rates** (counts/denominators per 9.1's
  metric), read-only.
- Given both the governor report (FR-9) and the flywheel trend (FR-12) need rates, when either runs,
  then both consume **one shared rate-computation** that reuses 9.1 FR-9's metric definition — there
  is no second, divergent rate implementation.

#### Negative Paths
- Given the report runs, when it executes, then it **only reads** the store — it issues no writes to
  store/registry and **does not throttle, block, or alter** any daemon or planning behavior (report,
  don't gate).
- Given an **empty store** (no signals), when reporting, then it shows zeroed/empty metrics
  gracefully (no divide-by-zero, no crash).
- Given malformed signal lines, when aggregating, then they are skipped (consistent with FR-5) and
  the report notes how many were skipped rather than silently under-counting.

### Done When
- [ ] Report computes aggregate spend + kickback/halt/retry rates, read-only.
- [ ] Rate computation is a **single shared function** (reused by FR-12), aligned to 9.1's metric.
- [ ] No writes, no gating/throttling side effects; empty store → safe zeros; bad lines → skipped +
      noted.
- [ ] Test: seeded store → assert computed rates; empty-store path (no div-by-zero); bad-line path.

---

## Story: Non-negotiable human approval gate (no build without a merged spec PR)

**Requirement:** FR-10
As the operator, I want it to be structurally impossible for the brain to cause a build without my
merged spec PR, so non-autonomy holds by construction.

### Acceptance Criteria
#### Happy Path
- Given the entire brain codebase, when an idea is processed, then **every** path from idea to any
  build passes through a human-merged spec PR — there is no code path `brain → build`.

#### Negative Paths
- Given the brain, when it runs, then it issues **no auto-merge** of its own spec PRs (asserted at
  every handoff path, not just the common one).
- Given the brain might **propose a harness self-edit**, when it does, then the edit is emitted as a
  **PR through the existing validation / no-auto-merge gates** — never auto-applied to the working
  tree or auto-merged.
- Given an attempt (test or future code) to call a build/merge entry point from within the brain,
  when exercised, then it is absent/guarded — a test asserts the brain module does not import or
  invoke the build/pipeline or merge entry points.

### Done When
- [ ] No `brain → build` path; no auto-merge on any handoff path.
- [ ] Self-edits are propose-only PRs through existing gates, never auto-applied.
- [ ] Test: structural assertion that brain neither invokes build/pipeline nor auto-merges; self-edit
      proposal goes through the gate, not the working tree.

---

## Story: Cross-repo isolation — authoring for A never touches B

**Requirement:** FR-11
As the operator, I want authoring confined to the target repo resolved from the registry, so working
on project A can never create branches/PRs or edits in project B (or the brain's own repo).

### Acceptance Criteria
#### Happy Path
- Given a confirmed target A with a canonical path from the registry, when authoring runs, then the
  branch, commits, and PR are created **only** in A's repo, resolved from A's registry `path`.

#### Negative Paths
- Given two registered repos A and B, when authoring for A completes, then B's working tree, branches
  and refs are **byte-for-byte unchanged** (assert B untouched).
- Given the brain process's own cwd is repo C (the harness repo), when authoring for A runs, then no
  branch/commit/PR is created in C — authoring never leaks into the brain's own repo.
- Given a registry `path` that **no longer exists** on disk, when resolving the target, then the
  brain errors clearly **before** writing anything (it does not fall back to cwd and author into the
  wrong repo — the Phase-9 recurring failure mode).

### Done When
- [ ] All writes confined to the resolved target repo path.
- [ ] Sibling repo B and the brain's own repo C are provably untouched after authoring A.
- [ ] Stale/missing target path → error before any write (no cwd fallback).
- [ ] Test: two real temp repos → author A, assert B unchanged; missing-path target → pre-write
      error; assert no writes in the brain's own repo.

---

## Story: Flywheel is measurable across successive brain-planned features

**Requirement:** FR-12
As the operator, I want the brain to compute whether kickback/halt/retry rates fall across
successive brain-planned features, so I can tell the loop is learning, not just accumulating noise.

### Acceptance Criteria
#### Happy Path
- Given store signals tagged to a sequence of brain-planned features, when the trend is computed,
  then the brain reports the kickback/halt/retry rate **per feature in order** and a trend
  (improving / flat / worsening) per 9.1's metric definition.

#### Negative Paths
- Given **fewer than two** brain-planned features in the store, when computing the trend, then it
  reports "insufficient data" rather than a spurious trend from a single point.
- Given features with **zero denominators** (e.g. a feature with no gate runs), when computing rates,
  then they are handled (excluded or shown as N/A) without divide-by-zero.
- Given signals from **non-brain-planned** work in the same store, when computing the brain-flywheel
  trend, then they are **excluded** (the metric measures brain-planned features specifically), so the
  trend isn't contaminated. **Note (cross-phase gap, conflict-check):** 9.1's signal schema has **no
  provenance field** distinguishing brain-planned from daemon-only work. The brain therefore
  identifies brain-planned features from its **own record of authored `(project, feature)` keys**
  (the specs it opened, FR-6/FR-7) and **intersects** that set with store signals by
  `(project, feature)` — requiring **no 9.1 schema change**. (ADR may additionally add a provenance
  marker to the 9.1 signal; until then, the intersection is the source of truth.)
- Given a brain-planned feature that has **not yet produced a signal** (spec merged but daemon not
  run / not finished), when computing the trend, then it is simply absent from the series (no
  fabricated zero) — the trend covers only features with emitted signals.

### Done When
- [ ] Per-feature rates + ordered trend computed per 9.1's metric (via the FR-9 shared function).
- [ ] Brain-planned set derived from the brain's authored `(project, feature)` keys, intersected with
      store signals — no dependency on a 9.1 schema provenance field.
- [ ] <2 features → "insufficient data"; zero-denominator → no div-by-zero; non-brain work excluded.
- [ ] Test: seeded multi-feature store → assert the trend direction; single-feature, zero-denominator,
      and mixed-source fixtures.
</content>
</invoke>
