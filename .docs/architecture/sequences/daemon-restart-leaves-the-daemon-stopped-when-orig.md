# Sequence: Origin-ahead restart converges without operator intervention (#353)

**Last updated:** 2026-07-06
**Scope:** The end-to-end flow that previously stranded the daemon `stopped`: CLI `daemon restart` while `origin/main` is ahead → fast-forward + engine rebuild → stale-engine verdict → skill relink → in-pane respawn on the new engine. Issue jstoup111/ai-conductor#353.

## Diagram

```mermaid
sequenceDiagram
    participant OP as Operator
    participant SUP as Supervisor CLI<br/>daemon-supervisor-cli.ts
    participant T as tmux pane
    participant D as Daemon (old engine)
    participant FS as Filesystem
    participant D2 as Daemon (new engine)

    OP->>SUP: conduct daemon restart
    SUP->>T: setRemainOnExit (FIXED form) + respawnPane -k
    T->>D: relaunch - still builds old engine at first
    Note over D: fast-forwards main «old-sha» to «new-sha»<br/>rebuilds dist - identity now differs
    D->>D: stale verdict (all gates pass)
    D->>FS: relinkSkillsForSelfBuild<br/>bin/install --update (#363-guarded)
    alt tmux session exists
        D->>T: triggerSelfRestart - respawnPane -k
        T->>D2: relaunch in SAME pane, session preserved
    else headless
        D->>FS: write unified restart marker
        D->>FS: release pidfile, exit 0
        Note over T: remain-on-exit keeps a dead pane<br/>revived by next start or ensureRunning nudge
        FS-->>D2: marker consumed on next boot
    end
    D2->>FS: ensureInstallFresh passes - skills already relinked
    D2->>FS: startup handshake - read and clear marker,<br/>loop-guard on target identity
    Note over D2: daemon status = running on «new-engine-id»<br/>never stopped / session-down
```

## Legend

- `«old-sha»` / `«new-sha»` / `«new-engine-id»` are placeholders for git SHAs and the versioned engine identity.
- **FIXED form** = `set-option -w -t =«name»: remain-on-exit on` — the prior invocation failed `no such window` and was swallowed, which is why the observed reproductions ended `session:down` even though the CLI restart path nominally set the option.
- The `alt` fork replaces the old unconditional write-marker-and-exit: with a live tmux session the daemon respawns itself in place via the existing tested transport; the marker+exit path survives only as the headless fallback, now recoverable because the pane remains.
- The skill relink happens **before** the respawn/exit so the successor process passes the non-interactive `ensureInstallFresh` gate.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-06 | Initial generation | DECIDE phase for issue jstoup111/ai-conductor#353 |
