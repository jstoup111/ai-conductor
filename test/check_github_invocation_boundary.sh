#!/bin/sh
set -eu
cd "$(dirname "$0")/../src/conductor"
npm test -- test/engine/github-ownership/24-enforce-the-production-invocation-boundary-mechanically.test.ts test/engine/github-ownership/24-exhaustive-direct-transport-detection.test.ts test/engine/github-ownership/24-boundary-audit-cli.test.ts
# The gate itself is the shipped CLI command, not a test-only import.
# This verifier is an operator-side check.  It must not inherit the maker-session
# marker when the enclosing integrity suite runs under daemon dispatch: the
# recursion guard is tested separately, while this command exercises the audit.
CONDUCT_DAEMON_SESSION= node --import tsx src/index.ts github-boundary-audit
