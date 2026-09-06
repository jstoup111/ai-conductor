# Track: Summarize the DECIDE artifacts in the spec land commit body

Track: technical

Scope boundary: Small residue of #1779, approved by the operator on 2026-09-06 (delegated). The
land primitive composes a descriptive message body from the DECIDE artifact content it already
reads, so the spec PR that autofill (or the composed-create path) derives from that commit carries a
real summary instead of an empty body. Excluded: the issue's second desired outcome — an
operator-attested rationale captured before exploration — which is an open design decision about
where and when the host asks, and belongs to its own feature; the commit subject line, which already
names the idea verbatim; the release-disposition composition owned by #1869; and any change to the
pull-request opener itself.

This is internal engine tooling with no product requirement; acceptance criteria live in technical
stories rather than a PRD.

The operator approved composing from the already-read artifact content over re-running a
diff-analysis PR skill on 2026-09-06 (delegated): the artifacts are in hand at the commit seam, the
composition is deterministic and testable, and it costs no extra model call.

Scope check: A — consumer-facing (the land and handoff primitives run in every repository that
installs the harness; no self-host, daemon, CI, or validation-gate surface is touched); B — n/a (no
new skill); C — provider-agnostic (no provider-specific behavior). No catalog registration is
required. Event spine: step 1 of the decision procedure returns "not a channel" — no watcher,
sidecar, reconstruction timestamp, or out-of-band signal is introduced, and the composed text is
human-facing prose that machinery is explicitly required not to read back.

Verified foundation: the land primitive commits with a bare single-line message and already holds
the track, the tier, the stories text, and the plan text in local scope at that seam; the pull
request opener derives the PR title and body from that commit; existing exported parsers split
stories into per-story blocks, return a named section body, and enumerate plan task bodies, so the
composition reuses them rather than adding parsing; and the build evidence reader matches a
`Task:`-prefixed trailer grammar in commit messages, which the composed body must not satisfy.
