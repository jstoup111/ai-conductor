# Track: daemon merged-PR guard on step retry (#358)

Track: technical

Internal daemon resilience fix — a mid-run race between the kickback retry chain and an
out-of-band manual PR merge. No user-facing product behavior; acceptance criteria live in
stories.
