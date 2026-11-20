# Verified rebase recovery for unattended builds

Tier: M

One recovery case spans admission to daemon dispatch and the existing rebase acceptance checks. Incorrect admission could advance a build with missing feature content. The design needs to account for interruptions, concurrent state changes, and proof associated with the current revision.
