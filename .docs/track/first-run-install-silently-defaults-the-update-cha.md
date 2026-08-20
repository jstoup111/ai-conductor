# Track: first-run-install-silently-defaults-the-update-cha

Track: technical

Scope boundary: `bin/install`'s first-run update-channel resolution only — add an explicit
`--channel` flag and a `AI_CONDUCTOR_CHANNEL` environment fallback, fix the precedence order, and
confirm the resolved channel (and the source it came from) in the install output. `stable`
remains the documented fallback when no source supplies a choice; the installer never fails
closed on a missing channel. Explicitly excluded: the markdown-viewer, mermaid-renderer, and
provider first-run prompts (which skip silently under the same non-TTY condition and are left
untouched); any `curl | sh` installer work; any change to `bin/update --set-channel`, to the
update-mode refresh path, or to how an already-configured channel is read.

## Rationale

This changes the installer's own input surface — a new flag, a new environment variable, and the
order in which they resolve. There is no user-facing product capability being specified, no new
runtime behavior an end user of a *conducted project* perceives, and no requirements worth
enumerating as FRs; the observable acceptance signals are installer invocations and their config
writes, which belong directly in stories. → **technical track** (skip `/prd`).

## Operator scope decision

The originating issue (jstoup111/ai-conductor#1711) asked for fail-closed behavior — "a first-run
install with no configured channel does not proceed on an implicit default ... non-interactively it
fails". The operator explicitly overrode that during `/explore`: **`stable` stays the fallback when
nothing supplies a channel.** The delivered outcome is therefore the *additive* half of the issue —
making an explicit choice possible and visible on every path — not the fail-closed half. The
interactive prompt keeps its current shape, including bare-Enter meaning `stable`.
