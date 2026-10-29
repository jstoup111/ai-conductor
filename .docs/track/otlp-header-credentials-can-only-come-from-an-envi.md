# Track: OTLP header credentials from a command (shared credential-reference resolver)

Track: technical

Scope boundary: a shared, source-extensible credential-reference resolver offering two dynamic sources in this slice, `{ env: <name> }` and `{ command: [argv...], prefix?: <string> }` (argv run without a shell, leading `~/` expanded to `$HOME`, trimmed stdout, optional prefix), with values re-resolved after a short cache TTL so a rotated credential is used without a restart. Its interface must fit the lifecycles of the other credential consumers (`github_bot.token_file`, the daemon build OAuth token, `tracker.credentials`) so they can adopt it later, but `otel.headers` is the only consumer moved in this spec, covering both spooled and direct OTLP/HTTP export. Excluded: migrating any other credential consumer (follow-up issues), file and native-keychain sources, shell-string commands, gRPC credential carriage.

Operator config capability with no product requirements beyond acceptance criteria; follows the #1939 technical-track precedent. Operator chose approach B (shared resolver) over an otel-local reference (A) and a daemon-wide env refresh (C), because dynamic sources beyond the environment are the requirement, not the environment itself.
