# Complexity: Routed remediation skips re-run steps on stale child verdicts, then exits markerless

Tier: M

Four bounded changes on existing seams inside the routed-repair engine. The first scopes a
routed host's child region verdicts to the routed round that produced them: a child verdict
records its round, and while a host is executing a round, the gate selection ignores a satisfied
child verdict from any other round, including unstamped verdicts already on disk. The second
keeps verdicts produced within the current round authoritative on resume. The third replaces the
silent `parked` loop exit, and the refused-completion exit, with a HALT naming the round, parking
kind and reason, recorded through #3445's bounded routing stall: `mechanical` for the first two
identical stalls, then `needs-human`. The fourth lets a host region already finished in the
current round take its routed exit on resume through the existing exit continuation.

There is no new service, dependency or CLI surface. The change adds one optional field to the
persisted gate-verdict record and reuses #3445's stall counter rather than adding one. It also
amends the approved `adr-2026-10-12-routed-whole-feature-repair` decisions 7, 9 and 13, so a
lightweight architecture review is warranted. Size matches the `size: M` label on issue #3455.
The plan stem must remain `routed-remediation-skips-re-run-steps-on-stale-chi`.
