# Track: status output hides completed features unless an option is passed

Track: technical

## Why technical

This is a display/ergonomics fix to an internal operator surface (the daemon's
inherited-state dashboard). There is a small product-ish flavor (a new operator flag),
but there is no new product domain, no data model, and the acceptance criteria are
mechanical (default omits the completed/PROCESSED group; an explicit flag includes it;
daemon.log never carries the completed set). Acceptance criteria live in the stories,
not a PRD.

## Context (verified against `main`)

The daemon prints an inherited-state dashboard at startup. It is rendered by
`renderDashboard(state, priorityResolution?)` in
`src/conductor/src/engine/daemon-dashboard.ts:461`. The completed/shipped features are
the PROCESSED group, emitted **unconditionally** at lines 552–554:

```ts
const processed = state.processed.filter((p) => !parkedSet.has(p.slug));
lines.push(`PROCESSED (${processed.length})`);
for (const p of processed) lines.push(`  • ${p.slug}${prSuffix(p.prUrl)}`);
```

There is no flag guarding it, so PROCESSED always renders after ELIGIBLE and buries
the active groups (PARKED/HALTED/IN-PROGRESS/GATED/WAITING/ELIGIBLE). As the shipped
backlog grows the completed entries dominate the output.

The dashboard is emitted at daemon startup from `src/conductor/src/daemon-cli.ts:1292`:

```ts
log(`\n${renderDashboard({ ...state, parked })}`);
```

Crucially, the `log` closure (`daemon-cli.ts:466-510`) **tees to both** the console
(`console.log`) and the persisted `.daemon/daemon.log` (`logSink.write`). So today the
full dashboard — PROCESSED included — lands in daemon.log and is tailed back by
`conduct daemon logs`. Satisfying "logs must never show completed" AND "an explicit
flag shows completed on the console" therefore requires **splitting the sink** at this
one call: always render a completed-excluding dashboard to `logSink`, and render the
completed-including variant to the console only when the flag is set. This is the one
non-trivial design point.

Daemon run args are parsed by `detectDaemonCommand(argv)`
(`src/conductor/src/engine/daemon-command.ts:164`) returning `DaemonCommandOptions`
(interface at `daemon-command.ts:14`); a new display flag is parsed here (mirroring
existing boolean flags like `--continuous`) and threaded through
`buildDaemonModeOptions` (`src/conductor/src/index.ts:143`) → `runDaemonMode`
(`daemon-cli.ts`) → the startup dashboard emit.

Note the distinct `conduct daemon status` verb (`runDaemonStatus`,
`src/conductor/src/engine/daemon-observe-cli.ts`) does NOT call `renderDashboard` and
does NOT print the PROCESSED set — so this change is scoped to the startup
inherited-state dashboard only.

## Approaches considered

1. **Add an options param to `renderDashboard` gating the PROCESSED group; split the
   startup emit so daemon.log never gets completed and the console gets it only under
   a new flag (chosen).** Default = omit completed. Add one boolean flag
   (`--completed`/`--all`) to `DaemonCommandOptions`, parse it in `detectDaemonCommand`,
   thread it to the emit. Minimal, additive, no behavior change to dispatch.

2. **Post-filter the rendered string to strip PROCESSED lines.** Rejected: brittle
   string surgery over structured rendering; breaks if the PROCESSED header/format
   changes.

3. **Drop the PROCESSED group entirely.** Rejected: the operator sometimes wants the
   shipped list; the flag preserves it on demand while decluttering the default.

Decision: **Approach 1.** The sink split at `daemon-cli.ts:1292` is the only part that
is not a trivial one-liner and is called out explicitly in the plan so the change does
not silently grow.
