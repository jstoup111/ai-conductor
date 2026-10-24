# Track: Daemon commits carry no bot Co-authored-by trailer and no skip event

Track: technical

Scope boundary: Balanced (operator-confirmed 2026-10-24). In scope: the executor child gets the bot co-author resolver under `executor_isolation: child` and `in-process` through one shared daemon-process bootstrap called by both the daemon entry point and the executor-child entry point; a closed skip reason when no resolver is installed at daemon dispatch (worktree preparation with `dispatchStart`), so operator-run CLIs stay silent; a test that exercises the child path; the ADR D10.1 cache-scope amendment (per daemon or executor process). Out of scope: removing the module-global resolver or making injection explicit (#1586 class), retiring `executor_isolation: in-process` (#3333), and any change to trailer format, hook stamping, or token confinement.

Restores behavior ADR adr-2026-09-11-github-operation-ownership D10 already specifies (silently lost under child isolation since #3306); no new product capability, so no PRD.
