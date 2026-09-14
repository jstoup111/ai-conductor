#!/bin/sh
set -eu
cd "$(dirname "$0")/../src/conductor"
npm test -- test/engine/github-ownership/24-enforce-the-production-invocation-boundary-mechanically.test.ts
