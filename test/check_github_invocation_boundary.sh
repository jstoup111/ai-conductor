#!/bin/sh
set -eu
cd "$(dirname "$0")/../src/conductor"
npm test -- test/engine/github-ownership/24-enforce-the-production-invocation-boundary-mechanically.test.ts test/engine/github-ownership/24-exhaustive-direct-transport-detection.test.ts test/engine/github-ownership/24-boundary-audit-cli.test.ts
# The gate itself is the shipped CLI command, not a test-only import.
node --import tsx src/index.ts github-boundary-audit
