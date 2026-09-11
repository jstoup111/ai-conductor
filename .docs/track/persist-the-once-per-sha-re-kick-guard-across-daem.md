# Track: Durable once-per-SHA re-kick guard

Track: technical

Scope boundary: Small fix for #286, approved by the operator on 2026-09-06 (delegated). Persist the base-advance re-kick sweep's per-feature last-rekick SHA to the main checkout's `.daemon/` store so the FR-9 bound survives a daemon restart, and hydrate the existing in-run guard from it at daemon start. Halt classification, park semantics, shipped-record dedup, the `.pipeline/REKICK` sentinel's own lifecycle, marker retention or pruning policy, and any event-spine reporting of re-kick intent stay outside this slice.

This is daemon machinery inside the harness repository; acceptance criteria live in technical stories rather than a PRD.

The operator approved the `.daemon/<subdir>/<slug>` marker store over a worktree-local `.pipeline/` record on 2026-09-06 (delegated). A worktree checkout is disposable and is routinely recreated or removed during recovery, so per-feature state that must fail closed belongs in the main checkout — the same reason `parked/`, `processed/`, `warned/`, and `grants/` already live there.

Scope check: A — harness-repo-only (daemon machinery; scope-check Decision A step 1 signal 1). B — n/a (no new skill). C — provider-agnostic (no provider surface is touched). No catalog registration is required. Decision A's table would send the documentation to the self-hosting guide, but the canonical page for daemon operational behavior is the daemon guide, and the repository's documentation-upkeep rule names it explicitly; the plain reading of that rule wins over the table.

Event spine: Channel? yes — a per-slug marker file. Concern: durable state — "has this feature already been re-kicked at base SHA X" answers what is true now and is read by name per slug, and it must outlive the process precisely because it is state. Verdict: no new channel, no schema change; exception C. The corresponding occurrence is already on the bus as `halt_cleared` with `cause: 'rekick'`, and nothing here reconstructs an occurrence from state.

Verified foundation: `daemon-cli.ts:1722` builds `lastRekickSha` as a bare in-memory `Map`, and `daemon-rekick.ts:220`/`:257` read and write it around the clear; nothing writes it to disk, so every restart empties it. `daemon-deps.ts:126` and the `hasWarned`/`markWarned` pair at `:348`/`:358` are the established `.daemon/warned/<slug>` marker shape this fix copies, already wired into the same sweep at `daemon-cli.ts:1742-1743`. `.daemon/` is gitignored. The governing halt-classification ADR's D7 carries forward "the once-per-feature-per-SHA bound" without prescribing where it is stored, and the operator-park ADR's alternatives already reject in-memory daemon-process state for anything that must survive a restart.
