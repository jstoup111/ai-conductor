**Status:** Accepted

# Stories: Intake convention — issues state WHAT and desired OUTCOMES; DECIDE owns HOW

Technical track (no PRD). Source: jstoup111/ai-conductor#490. Tier: S.
Design intent: three legs — deterministic scaffolding (issue template), a binding
convention rule (HARNESS.md), and a judgment layer (engineer + explore skills).

---

## Story: Intake issue template scaffolds the WHAT/outcomes shape

As an operator (or teammate) filing an intake idea from the GitHub web/mobile UI,
I want the new-issue form to scaffold Observed / Impact / Desired outcome /
Hypotheses so that the issue states the problem and outcomes without prescribing
an implementation.

### Acceptance Criteria

#### Happy Path
- Given the repo's new-issue chooser, when the filer picks the "Intake idea" template,
  then the form presents exactly these sections: **Observed** (evidence of the problem),
  **Impact** (who/what hurts, how often), **Desired outcome** (observable behavior that
  must hold afterward), and **Hypotheses** (optional, explicitly captioned as the filer's
  guesses about HOW — not requirements, and DECIDE may discard them).
- Given the template, when the filer fills only Observed and Desired outcome and submits,
  then the issue files successfully — Impact and Hypotheses are optional (filing stays
  phone-cheap; at most Observed + Desired outcome are required).
- Given the Hypotheses field, when rendered, then its description text states that the
  engineer's DECIDE phase owns HOW and will weigh alternatives against any sketch here.

#### Negative Paths
- Given the new-issue chooser, when a filer needs a fully freeform issue (e.g. a plain
  bug report or non-intake note), then a blank issue remains available — the template
  MUST NOT be made mandatory (no `blank_issues_enabled: false` in an ISSUE_TEMPLATE
  config).
- Given the template file as committed, when GitHub parses it, then it renders as a
  working template rather than falling back to a blank form — verified by `gh api
  repos/{owner}/{repo}` template listing or by loading the new-issue chooser after merge
  (malformed YAML silently degrades; the check must be explicit).

### Done When
- [ ] `.github/ISSUE_TEMPLATE/intake.yml` (issue form; repo is public so forms are
      supported) exists with the four sections above; only Observed and Desired outcome
      marked `required: true`.
- [ ] No `.github/ISSUE_TEMPLATE/config.yml` disabling blank issues is introduced.
- [ ] Template YAML passes a syntax check in CI-adjacent validation (at minimum
      `python -c "import yaml,sys; yaml.safe_load(open(...))"` or equivalent run in the
      task) and renders in the new-issue chooser after merge.

---

## Story: HARNESS.md carries the intake-level WHAT/HOW convention rule

As a harness maintainer, I want a written convention — intake states WHAT and desired
OUTCOMES; the engineer (DECIDE) owns HOW — so that the division of responsibility is
explicit and binds every filer, including agents filing issues on the operator's behalf.

### Acceptance Criteria

#### Happy Path
- Given HARNESS.md's conventions section, when read, then a new additive rule states:
  intake issues state the problem (Observed/evidence), its Impact, and Desired outcomes
  (observable); solution content is at most a labeled Hypothesis; the engineer's DECIDE
  phase owns HOW. The rule is placed alongside the existing "PRDs are product-only" rule
  and names it as its product-phase twin.
- Given the rule text, when an agent (e.g. a phone Claude session) files an intake issue
  via `gh issue create` — where web templates do NOT auto-apply — then the rule
  explicitly directs the agent to follow the same Observed / Impact / Desired outcome /
  Hypotheses shape in the issue body.

#### Negative Paths
- Given a filer with a genuine design idea, when they include it under a clearly labeled
  Hypotheses section, then the rule permits it — the convention demotes embedded designs
  to hypotheses; it MUST NOT ban recording them (banning would make filing more
  expensive and lose information).
- Given the harness validation suite, when run after the HARNESS.md edit, then it passes
  — the rule is additive prose and MUST NOT break the generated model-selection-table
  section or any structural check.

### Done When
- [ ] HARNESS.md contains the new convention rule adjacent to "PRDs are product-only",
      covering both human filers and gh-CLI-filing agents, and explicitly allowing
      labeled Hypotheses.
- [ ] README.md documents the intake-issue shape where intake/engineer flow is described
      (docs-track-features rule).
- [ ] `test/test_harness_integrity.sh` passes.

---

## Story: Engineer capture treats embedded solution content as hypothesis

As the engineer (idea→spec loop), I want any solution design embedded in a claimed
intake idea to be explicitly reframed as the filer's hypothesis at capture time, so
that the DECIDE phase starts from the problem and outcomes rather than the filer's
first sketch.

### Acceptance Criteria

#### Happy Path
- Given `skills/engineer/SKILL.md` step 1 (capture), when an idea's text contains
  solution content ("Fix direction", "Design sketch", "Proposal", concrete seams or
  function names — whether or not it followed the template), then the skill instructs
  the engineer to carry that content forward into DECIDE labeled as the filer's
  hypothesis, and to pass the problem/outcome statement — not the sketch — as the
  primary framing to /explore.

#### Negative Paths
- Given a claimed idea that is a pure design sketch with no stated problem or outcome,
  when the engineer captures it, then the skill directs it to derive/confirm the WHAT
  (problem + desired outcome) with the operator before routing into /explore — it MUST
  NOT spec the sketch verbatim as if the sketch were the requirement.

### Done When
- [ ] `skills/engineer/SKILL.md` step 1 contains the hypothesis-reframing instruction
      (including the pure-sketch fallback) and step 3 threads it into the /explore
      handoff.
- [ ] `test/test_harness_integrity.sh` passes (frontmatter + cross-references intact).

---

## Story: Explore still diverges when the idea carries an embedded design

As the /explore skill, I want an embedded filer design to enter approach generation as
at most one candidate among genuine alternatives, so that the divergent half of DECIDE
is never skipped by anchoring.

### Acceptance Criteria

#### Happy Path
- Given `skills/explore/SKILL.md`, when the incoming idea carries an embedded solution
  design (hypothesis), then the skill instructs explore to (a) treat it as one candidate
  approach at most, (b) generate at least one genuine alternative that does not derive
  from the filer's sketch, and (c) weigh them on merits before recommending.

#### Negative Paths
- Given the filer's hypothesis is judged best on merits after weighing, when explore
  recommends it, then the instruction permits adopting it — the rule prevents *default*
  adoption (anchoring), it MUST NOT forbid the filer's idea from winning.
- Given an idea with no embedded design, when explore runs, then behavior is unchanged —
  the instruction is conditional and adds no ceremony to clean WHAT-only intakes.

### Done When
- [ ] `skills/explore/SKILL.md` contains the conditional embedded-design instruction
      (candidate-not-default, ≥1 genuine alternative, may still win on merits).
- [ ] `test/test_harness_integrity.sh` passes.
