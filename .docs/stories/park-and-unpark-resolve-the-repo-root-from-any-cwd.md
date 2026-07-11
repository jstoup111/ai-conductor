# park and unpark resolve the repo root from any cwd

Status: Accepted

## Context

During the emergency stop of the #520 false ship (2026-07-11 ~14:15Z), an operator ran
`daemon park <slug>` from **inside the affected worktree's subdirectory** and got:

```
error: slug 'evidence-gate-validates-provenance-proxies-not-whe' not found in plans/ or worktrees/
```

The slug was correct and `.worktrees/evidence-gate-validates-provenance-proxies-not-whe` existed
the entire time; re-running from the repo root moments later succeeded. Cost: ~90 seconds of
retry/fumbling while a live finish session was moving toward pushing a build the engine had judged
incomplete (7/26 tasks unresolved). `daemon park` is exactly the tool an operator reaches for
mid-incident, from wherever their shell happens to be — a cwd-dependent failure at that moment
delays containment of false-ships and runaway dispatches, and the misleading "slug not found" text
sends the operator into a re-typing detour instead of a `cd`.

Root cause: `validateSlug` / `dispatchDaemonPark` in
`src/conductor/src/engine/daemon-park-cli.ts` scan `.docs/plans/<slug>.md` and `.worktrees/<slug>`
relative to `process.cwd()` (passed straight through from `index.ts`). These directories live in
the **main repo root**, so any cwd other than that root fails. Fix per the issue's hypothesis and
the #486 precedent (`memory-store.ts`): resolve the main repo root from any cwd via
`git rev-parse --git-common-dir` before scanning.

## Story 1 — park and unpark resolve the same repo root from any cwd inside the repo

As an operator stopping a running feature, I run `daemon park <slug>` (or `unpark <slug>`) from
wherever my shell is — the repo root, a linked worktree's root, or any nested subdirectory of
either — and it acts on the same project root and produces the same result, so I never have to
`cd` first during an incident.

### Happy Path

- **Given** a project with a valid slug (its `.worktrees/<slug>` or `.docs/plans/<slug>.md` exists
  in the main repo root),
- **When** I run `daemon park <slug>` from the main repo root, then again (after unparking) from a
  nested subdirectory of the main root, then again from inside the feature's own linked worktree
  (`.worktrees/<slug>/…`),
- **Then** every invocation resolves to the same main repo root, writes the operator-park marker
  under that root's `.daemon/parked/<slug>`, exits 0, and prints the confirmation naming the slug —
  identical behavior regardless of cwd.
- **And** `unpark <slug>` invoked from any of those same locations resolves the same root, removes
  the marker, exits 0, and prints its confirmation (symmetrical with park).

## Story 2 — invoked outside any repo, the error names the expected usage and touches no state

As an operator who mistypes or runs from an unrelated directory, I get an error that tells me what
to do rather than a misleading "slug not found", and nothing is parked or unparked.

### Negative Path — outside any git repository

- **Given** a cwd that is **not inside any git repository** (root resolution fails),
- **When** I run `daemon park <slug>` (or `unpark <slug>`),
- **Then** the command exits non-zero and prints a message that names the expected usage
  (e.g. "not inside a conduct project — run from the project root or a directory inside it"),
  **not** the misleading `slug '…' not found in plans/ or worktrees/`,
- **And** no park marker is created or removed anywhere (no state is touched — the dispatch is
  never reached).

### Negative Path — a genuinely nonexistent slug (right cwd, wrong slug)

- **Given** a cwd inside the repo but a slug with **no** `.docs/plans/<slug>.md` and **no**
  `.worktrees/<slug>` under the resolved main root,
- **When** I run `daemon park <slug>`,
- **Then** it exits non-zero with the not-found error, and that error is **distinguishable** from
  the outside-a-repo case (it names the resolved root that was searched, confirming the cwd was
  fine and the slug is the problem), and no marker is written.
