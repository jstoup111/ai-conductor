# Track: intake-marker plan-stem keying (fix #207)

Track: technical

Internal harness plumbing — `engineer land` writes the intake marker under the idea slug
while the daemon (owner-gate + issue auto-close) reads it by the plan stem. No user-facing
product behavior; fix converges the write side on the existing plan-stem contract.
