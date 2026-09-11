# ADR: Portable build review policy with candidate-bound evidence and one repair authority

**Date:** 2026-09-10
**Status:** APPROVED
**Approved:** James Stoup, 2026-09-10, including read-only policy adaptation and initial Linux/bubblewrap containment
**Deciders:** James Stoup (operator); composer session for jstoup111/ai-conductor#1986
**Scope:** The approved #1986 PRD, including #1804's effective-policy cache correction. General custom-step redesign in #1344 is excluded.

## Context

The approved approach preserves independent rubric judgments and extends the existing shared adjudicator. The current implementation has four relevant limitations: rubric identifiers and findings are closed over `testQuality`; cache identity is computed from the harness root before actual provider preparation; provider transports receive a semantic token whose native lookup is not bound to those hashed bytes; and the conductor's adjudication branch is daemon-only.

This proposal establishes one integration boundary from project policy selection through effective candidate preparation to validated evidence. It also extends the existing case contract to express cross-case consistency and a decision stop. These are structural decisions about component ownership, provider integration, and durable identity; an ADR is warranted. Existing fan-out, operator risk, case/effect persistence, retry, and event contracts are reused.

## Options Considered

### Option A: Native name invocation and harness-root cache identity

- **Pros:** Retains the smallest existing dispatch shape.
- **Cons:** Does not establish which installation or supporting bytes the actual candidate loaded. Host lookup and fallback may diverge. Cannot satisfy the approved provenance and cache requirements.

### Option B: Require a new harness-specific skill package in every project

- **Pros:** Makes discovery and output contracts simple.
- **Cons:** Requires copies or repackaging and defeats installed-policy adoption. A separately dispatched custom lifecycle step would also duplicate review authority.

### Option C: Resolve installed content, bind candidate execution, and extend the existing aggregate (recommended)

- **Pros:** Preserves distribution identity and independent evidence; prevents cache/dispatch disagreement; reuses the single adjudicator and durable effects.
- **Cons:** Adds provider catalog adapters, immutable execution material, and enforced read-only containment for custom-policy laps. Arbitrary automation skills are not automatically compatible with a read-only review role.

## Decision

### D1 — Keep one public gate and distinguish declarations from execution policy

Add `build_review.custom_rubrics`, a map of project rubric declarations. Retain `build_review.rubrics.testQuality` and its existing execution policy. Each custom declaration has `skill` (semantic identity), `question` (the review question it contributes), optional `source` (`project`, `global`, or `plugin`; omitted means require a unique match), optional `resources` (additional required package-relative resources), and the existing per-rubric execution-policy fields. A custom declaration defaults disabled; enabling is explicit. `skill` accepts a standalone name or `plugin-name:skill-name`, with no provider invocation prefix or filesystem path.

Custom ids use a bounded identifier type: 1–64 ASCII letters, digits, hyphens, or underscores, starting with a letter. Reject built-in and retired ids, duplicate YAML keys, prototype keys, invalid fields, and malformed declarations before dispatch. Initial maximum is 32 custom declarations; existing fan-out concurrency limits still apply. The effective catalog is constructed once per lap and passed explicitly to consumers. No runtime module adds an independent hardcoded list of custom ids.

Unknown or retired members in the old `rubrics` subtree retain their current behavior. In particular, the inspected baseline rejects unknown ids and warns/ignores retired ids; adding a similarly named custom declaration does not reinterpret a legacy key. Reject an enabled custom rubric combined with disabled aggregate adjudication. A disabled public gate still disables all rubric execution as today; disabled custom declarations do not resolve installations, request judgments, or inspect caches.

### D2 — Resolve semantic identity through explicit installed-catalog adapters

Introduce a review-domain `InstalledReviewSkill` descriptor carrying semantic name, source scope, plugin identity when applicable, installation origin, local package version when known, canonical skill path, package root, and declared dependencies. Resolve against the actual candidate's prepared environment, with original catalog roots mapped explicitly by preparation where necessary. Do not guess the operator home from the engine's ambient environment after preparation.

For Codex, use a bounded local app-server metadata request: `skills/list` with the feature cwd and `forceReload: true`. Its emitted schema contains `path`, `scope`, `enabled`, and `pluginId`, plus per-cwd errors. Plugin metadata is read through the corresponding typed plugin descriptor and local package manifest only as needed. No turn is started and no model is invoked for discovery. For Claude, enumerate project and configured user skill roots and use `claude plugin list --json` for installed/enabled plugin roots, then read the declared skill locations in their manifests. Do not enumerate every cached version or available marketplace listing and call it installed.

Both adapters normalize into the same descriptor. Only enabled, locally materialized installations qualify. A cloud-only package without the required local resources is diagnosed as unloadable; the engine never downloads or installs it as part of review. An unqualified selection with multiple distinct canonical matches is ambiguous even if a host would silently choose one. Symlinks pointing to the same canonical installation may be deduplicated; byte-equal copies at distinct origins are not silently merged. The optional source selector or plugin-qualified name disambiguates without an absolute project configuration path.

Catalog errors, partial output, unsupported response versions, disabled policy, absent resources, and missing host capabilities are typed failures. A successful CLI exit with a partial-list warning is not evidence of absence or completeness. Discovery processes are bounded, canceled with their owning candidate, and torn down on success, cache hit, failure, or cancellation. No operator configuration, plugin enablement, or installation state is mutated.

### D3 — Bind the complete policy bundle to execution

Read the skill definition, provider metadata, package manifest, and supporting resources into a content-addressed bundle before lookup. Preserve package-relative paths. For a standalone skill, the skill directory is the package boundary; for a plugin skill, its declared plugin root is the boundary. Hash sorted relative paths and raw file bytes, including symlink destinations after safe canonical resolution and declared version/identity metadata. Resolve symlinks within the admitted package, detect cycles, reject escape paths and special files, and reject missing declared resources or broken local Markdown links. Additional dependencies must resolve within the declared package boundary; remote or dynamically generated dependencies are not silently omitted.

Default bundle limits are 4,096 files and 64 MiB of total bytes. Exceeding either yields a named policy-loading failure, not truncation. Package bytes are captured once and rechecked for concurrent source changes before accepting the bundle. Store execution-only material under feature-local ignored runtime state; this is not a maintainer-authored copy or a committed policy fork. Original installations remain untouched. Retry may rematerialize a bundle, but durable evidence retains its identity.

Send the exact captured `SKILL.md` text and the engine-owned review contract to the existing provider invocation, with the captured supporting tree available read-only. Do not send only an unresolved slash/dollar token and hope it selects the hashed installation. Discovery metadata and invocation mechanics remain provider-specific; the selected policy text and required result contract are common. This is a review-domain adaptation, not a rewrite of all lifecycle skill invocation.

### D4 — Define the supported installed-policy contract explicitly

Project selection adopts a skill as a read-only review policy: its criteria and supporting knowledge inform findings against the supplied implementation input. It does not authorize the skill's standalone workflow to edit code, publish comments, install dependencies, or replace the aggregate verdict. Documentation must explain this mode and the adapter precedence over a skill's standalone output format.

The engine supplies the complete selected skill text, resource locations, declared question, scope, and a generic bounded finding schema. No new harness-specific frontmatter, installed-file edit, or package republishing is required. Standard required metadata/dependencies are parsed before judging; missing resources and declared capabilities unavailable under this role fail before a judging call. The engine does not claim to mechanically understand arbitrary prose instructions: undeclared dynamic dependencies or a skill that cannot operate under the review contract produce an explicit unsupported-policy result, never an empty-findings success. Semantic compatibility is not inferred from a keyword allowlist.

Provider-specific required tools are neither silently substituted nor ignored. Optional unrelated plugin components are not activated merely because a skill is selected. There is no blanket claim that every existing automation skill is a valid review policy. The motivating private Kotlin package remains unverified until its contents can be inspected; it is not used as an acceptance fixture or a promise of proven compatibility.

### D5 — Enforce immutable review access when custom policies participate

For a lap with any enabled custom rubric, prepare a feature-local frozen source view at the reviewed baseline/head and bind every rubric in that lap to it, including built-in peers. Give branches separate writable provider scratch and no sibling review evidence. The frozen input, original feature checkout, original policy installation, and engine-owned evidence stores are not writable by a reviewer. Provider results return through the existing invocation result stream; the engine writes validated branch artifacts.

Use a provider-neutral read-only invocation profile passed through the existing `invoke` member. The initial Linux implementation uses an explicit bubblewrap mount boundary with read-only source/policy mounts and enumerated writable attempt scratch/provider state. It must compose with the existing self-host prepared invocation, not replace its protections or widen the live-checkout exclusion list. Do not use the current self-host bind set unchanged: it deliberately makes the feature worktree writable.

Prove denied writes to disposable protected sentinels and permitted writes to private scratch before launching a reviewer. Keep provider client runtime/auth needs inside its private state. Do not copy unrelated plugin hooks, MCP connections, or tracker credentials into that review environment. An unavailable containment backend, failed two-sided probe, or incompatible nested host sandbox yields an unsupported-capability diagnostic naming the provider and recovery action. There is no prompt-only or writable fallback. Other platforms need an equally proven backend before custom-policy execution is supported there.

Built-in-only projects retain their existing dispatch and enablement behavior; they receive D6's cache correction without a new custom-policy containment prerequisite. All members of a custom-policy lap are protected uniformly. This scope follows the PRD's existing-project compatibility requirement while making the new multi-policy input guarantee mechanical.

### D6 — Move policy-dependent cache operations inside candidate preparation

Keep the engine content stamp as one injected per-run value. Move effective policy resolution, policy-content identity, lookup, dispatch, validation, and eligible write into one actual-candidate boundary. Preserve candidate ordering, availability handling, safety supervision, timeouts, metering, fresh sessions, and teardown. Add a typed optional candidate operation to the existing execution machinery rather than a second provider invocation member or a parallel fallback loop. Callers outside build review retain their current path.

The cache identity includes rubric declaration identity, rubric/result/projection contract versions, semantic input digest, existing execution-policy fingerprint, engine stamp, effective bundle digest, actual provider, and its resolved model/effort policy. Paths of temporary homes, lap ids, timestamps, and commit-address-only changes remain provenance rather than semantic identity. A fallback candidate looks up and writes only under its own effective identity. A hit carries the original producing provenance and a separate current-lap reuse reference; it does not invent a new provider execution or token usage.

Partition stored entries by rubric and candidate identity to avoid one fallback overwriting another's warm result. Validate entries strictly; legacy entries without effective-policy evidence miss with a distinct reason and are replaced lazily. Policy load failure never reaches lookup or write. Native discovery errors are configuration/coverage failures, not provider unavailability that buys a different judgment; normal provider/model unavailability alone retains the existing fallback route.

Built-in policy identity follows the same actual-candidate rule. Resolve the definition the candidate would use, capture it, and deliver those bytes, instead of retaining the old harness-root approximation. Keep existing built-in finding/disposition semantics: changing cache provenance alone does not erase an operator's existing accepted-risk decision.

### D7 — Extend result identity without weakening the built-in rubric contract

Keep `testQuality`'s existing vocabulary, candidate-scope resolution, preflight, and content anchors. Introduce a generic custom-review result contract with content-grounded findings: a bounded concern id, summary, confidence when supplied, evidence locations, and engine-validated source-region references against the frozen changed input. A custom reviewer cannot select its durable rubric, lap, provider, bundle identity, verdict, case id, or effect id; the engine stamps those after parsing. The effective catalog supplies the correct parser/projection per member.

Custom evidence has a versioned declaration identity covering rubric id, semantic policy, question, and source selection, plus effective policy identity. Evidence and operator dispositions must distinguish a changed policy from a same-named prior policy. Semantic repeated-case judgment still sees prior cases; a policy update never resets cumulative retry bounds. Persisted evidence carries enough validated descriptor identity to remain readable when the current configuration removes or disables a custom member. Do not make historical parsers depend on today's enabled catalog.

> **Amended 2026-09-10 by #1986:** adr-2026-09-10-separate-custom-review-coverage-identity D1–D4 supersedes only the common binding of custom operator dispositions here. Accepted risk remains bound to the judged finding and effective content. Reduced coverage binds to the feature, validated policy declaration (including resource selections), and closed failure reason without requiring unavailable content; it survives package updates while that same failure persists, becomes inert on successful judging, and never suppresses findings. The operator approved this distinction and its persistence cost on 2026-09-10. All existing operator authority, exhaustion, and minimum-judged-coverage checks remain.

Apply confidence floors through the existing suppression authority. Suppressed findings remain visible context without becoming source rows or operator accepted risk. Dynamic rubric ids must reach aggregate parsing, accepted-risk/reduced-coverage parsing, cache readers, event rendering, and recovery, not just dispatch.

### D8 — Give the existing adjudicator enough policy and scope evidence

Extend the existing `build_review` case context with each current rubric's declared question, effective policy identity, relevant policy criteria, the reserved lifecycle ownership map, and the full admitted task contracts needed to judge repairs. Include all current unresolved content and all prior cases within the existing bounded context. Missing scope evidence or overflow stops with a reason; it does not authorize speculative work. Infrastructure and exact operator decisions retain their separate existing handling.

One `remediate` judgment decides semantic overlap, cross-case contradictions, review-question ownership, and whether a proposed repair is admitted by the approved plan. It may merge equivalent findings, reject a finding that attempts to reclaim another authority's question, or stop for a product/plan/architecture decision. A declared question is contextual policy, not a string-matched proof of exclusive ownership. No second model judges the adjudicator's semantic answer and no prompt-text matcher re-derives it.

### D9 — Extend the existing case contract with explicit consistency and escalation

Add a versioned `case-v2` mode to the existing remediation artifact/parser/store flow; retain `case-v1` and existing non-case remediation compatibility. The v2 result contains the existing complete source-to-case graph plus a consistency decision (`consistent` or `blocked`), implicated source/case references, and a non-empty rationale. Each `act` task also names the existing plan task ids that admit the repair and an admission rationale. Add an `escalate` case/source outcome naming `product`, `plan`, or `architecture`, with no autonomous external effect and with required operator-facing evidence.

Mechanical validation checks exhaustive source coverage, bounded fields, recognized references, actual task ids, graph consistency, and effect legality. Semantic compatibility of different repairs remains the adjudicator's schema-constrained judgment. A `blocked` consistency result, any escalation, invalid output, or missing required admission evidence prevents all action effects for that adjudication and produces a durable decision stop. The implementation worker never receives a partly unresolved contradictory set. A consistent result with admitted actions uses the existing one-work-order effect path. Existing independently blocking infrastructure remains blocking even when mixed-lap content authorizes a repair.

A current requirement/plan/architecture gap cannot be converted to a non-blocking deferred issue merely to settle the lap. Existing deferral remains available only for work outside the current approved outcome and is subject to its existing durable effect contract. Escalation does not append tasks, rewrite sealed artifacts, grant risk acceptance, or spend a BUILD charge. On explicit decision resolution, recovery re-evaluates against the new approved baseline rather than editing an old verdict into PASS.

### D10 — One authority across attended and daemon execution

Extract the review-outcome application path currently nested under the daemon-specific branch into a shared review-domain operation that both custom-policy execution modes call. It invokes the existing adjudication coordinator once, persists a result bound to the current lap, and returns a typed route. Daemon navigation and attended checkpoint presentation consume that result; neither independently recomputes raw findings into a kickback. The daemon must not adjudicate a second time when the shared operation has already settled the lap.

Keep built-in-only compatibility paths intact where their existing behavior differs. Any enabled custom member forces the shared authoritative path, including legacy/scalar provider wiring. If a path cannot supply the required provider capability, it refuses that custom review before judging rather than silently taking raw-FAIL routing.

### D11 — Reuse durable effects and all existing convergence limits

> **Amended 2026-09-11 by #1986:** The newly merged #2409 amendment to the shared case ADRs is retained. Repeated-case stop here means an unrefuted attempted act; an admitted one-time evidence-backed refutation uses the inherited refute/refuted terminal without a BUILD route or charge. #2409 owns that primitive and must implement it before this feature builds. Custom case-v2 retains its validated contract.

Keep the current case store, work-order store, exact operator disposition store, and kickback ledger as the only owners of their state. Extend their schemas additively/versionedly to carry custom identity, consistency, and escalation. Production defaults remain filesystem-backed, leased, atomically replaced, and fail closed on corruption. No new independent retry ledger or case store is introduced.

Preserve one charge per new aggregate action effect, idempotent interrupted-effect recovery, attempted-case repeat stops, and current-lap source binding. Configuration removal, policy-content changes, provider fallback, and incidental tree movement never reset cumulative limits. An unapplied effect cannot become a settled PASS. A changed custom policy invalidates stale evidence and exact settled-source reuse; semantic prior-case reasoning still prevents repeated repair under drifting identifiers.

### D12 — Extend the existing event schema and documentation

Add typed policy-resolution/failure and effective-provenance fields/events to `ConductorEvent`, declare their render/persist/audit sinks, and carry custom identifiers through existing displays. Cache reuse/discard, judgment, adjudication consistency, escalation, and effect outcomes use the existing emitter/persister chain. Do not add a telemetry file or observer process to infer them.

Execution bundles, validated verdicts, and case state are durable evidence under event-spine exception C. Their write occurrences remain events. Avoid credential material and full policy bodies in telemetry; provenance is identity plus source/version labels and relevant bounded diagnostics. Consumer guidance covers selection, ambiguity, supporting resources, containment readiness, expected unsupported-policy errors, cache identity, and decision stops. New invocation-profile semantics are scoped to the read-only review role, not silently applied to ordinary BUILD or general custom steps.

## Consequences

### Positive

- One configuration selects installed policy across both hosts, with explicit failures rather than opposite missing-skill outcomes.
- The provider actually judging and the policy actually delivered determine evidence and cache identity.
- Independent policies cannot independently cycle the build, and every accepted repair is traceable through the existing durable authority.

### Negative / Operator decisions required

- Initial custom-policy execution requires proven Linux/bubblewrap containment. Unsupported systems stop before review; adding another platform backend is separate work, not a writable fallback.
- An installed skill is adopted in read-only review mode, not as arbitrary standalone automation. Incompatible required actions or resources are diagnosed; the private Kotlin example has not been verified.
- Host metadata schemas can change. Version-aware parsers and faithful fixtures must fail clearly rather than silently choose a cached directory.
- Effective bundle hashing may conservatively invalidate a judgment when an unrelated file inside the declared package changes. This spends review work to preserve correctness.
- A model can make a bad semantic conflict decision. Complete retained sources, a required consistency judgment, explicit admission references, and bounded replay make it inspectable; mechanical checks cannot prove semantic correctness.

## Existing ADR amendments applied in DECIDE

The following statements carry additive amendments in this DECIDE branch, preserving their original text:

- `adr-2026-08-22-build-review-opt-in-rubric-container` D1/D4: add project-declared members and generic custom result identity; preserve built-in defaults, retired keys, and the empty-container behavior.
- `adr-2026-08-21-engine-identity-in-build-review-cache-key` D3/D6/D7: effective complete policy identity is candidate-bound for cache operations; built-in accepted-risk binding remains unchanged, while new custom policy identity belongs to its own versioned evidence/disposition contract.
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` D2 and its inherited case contract: add v2 consistency/admission/escalation and shared custom-policy execution across attended/daemon paths; preserve mixed-lap infrastructure precedence and existing effect/convergence ownership.
- `adr-2026-08-22-one-owner-per-review-question`: custom review questions enter through policy context and one adjudicator without reclaiming product completion, architecture choice, or plan-growth authority.

No accepted story from an older feature is assigned to BUILD for amendment. No production directory deletion is part of this proposal.

## Follow-up Actions

- [x] Operator approved this architecture and its explicit containment/compatibility trade-offs on 2026-09-10.
- [x] Applied the listed adjacent ADR amendments in DECIDE; this ADR is APPROVED.
- [ ] Produce accepted stories with positive and negative coverage dispositions and explicit policy-adapter prerequisites.
- [ ] Bind each production integration and its scoped proof to an implementation task after conflict-check.
