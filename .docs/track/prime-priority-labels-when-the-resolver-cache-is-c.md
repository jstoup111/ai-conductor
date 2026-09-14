# Track: Prime priority labels when the resolver cache is cold

Track: technical

Scope boundary: Small fix for #2158, approved by the operator on 2026-09-06 (delegated). The slice
covers the priority resolver's own read cadence — a resolve that has never read a linked spec's
labels must read them before it bands the backlog, and must degrade to the existing fallback mode
when that read fails. Cache invalidation policy, relabel freshness between refresh scans, the
daemon's refresh-only-when-idle discovery cadence, persisted priority state, and any change to
eligibility, parking, or dependency gating are outside this slice.

This is internal daemon scheduling behavior with no product requirement of its own; acceptance
criteria live in technical stories rather than a PRD.

Approach chosen over two alternatives, approved by the operator on 2026-09-06 (delegated).
(a) Read the labels of refs the resolver has never read, on any resolve, and keep the existing
outage contract on that read — chosen: it fixes every cold-entry path with one read site, and the
steady-state poll still makes zero calls once every ref has been attempted. (b) Report fallback
whenever the cache is cold — honest on the dashboard but leaves the post-restart drain in plan-file
order, which is the defect. (c) Make the daemon's first discovery a refresh pass — changes the
discovery cadence and fast-forwards origin at boot, a materially wider blast radius than the
ordering bug warrants.

Scope check: A — consumer-facing (daemon backlog scheduling ships to every repository that runs the
daemon; no self-host, release-gate, CI, or repo-convention signal fired). B — n/a (no new skill).
C — provider-agnostic (no provider path, variable, or capability is involved; the label source is
the tracker client, not a model host). No catalog registration and no rule text is required: the
change alters no documented contract, and no page under the documentation tree states the label
read cadence, so no canonical page goes stale.

Verified foundation: `createPriorityResolver` in `src/conductor/src/engine/backlog-priority.ts`
calls its `IssueLabelReader` only when `options.refresh` is true — the guard is
`options.refresh || sourceRefs.length === 0`, and the inner body is a no-op in the second case — so
a `refresh:false` resolve over an empty cache falls through to the band-building loop, maps every
ref to `unlabeled`, and returns `{ mode: 'banded' }`. `localWorkSource.discover` in
`daemon-work-source.ts` passes its own `refresh` straight through to that resolver and hands the
result to `orderBacklog`, which annotates each item with `resolutionMode` — the field
`daemon-dashboard.ts` reads to decide whether it reports banded or fallback ordering. The daemon run
loop in `daemon.ts` only reaches `discoverBacklog({ refresh: true })` when the local `refresh:false`
pass produced no eligible candidate, so a non-empty backlog never triggers a refresh discovery.
`renderStartupDashboard` does run one refresh discovery at boot and primes the shared resolver, so
the plain restart case is already covered — but that hook returns early when the daemon boots
paused, and a spec held back by the dependency gate is absent from the resolved item list until it
becomes eligible on a later non-refresh pass. Both leave the resolver banding a cold cache.
`adr-2026-07-03-priority-from-linked-issue-labels` already states the intended behavior — "The first
scan of a daemon run primes the cache" — and `adr-2026-07-03-priority-fetch-fail-soft` fixes the
outage contract this change must preserve, so no ADR amendment is required.
