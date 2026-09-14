#!/bin/sh
set -eu
cd "$(dirname "$0")/../src/conductor"
npm test -- test/engine/github-ownership/24-enforce-the-production-invocation-boundary-mechanically.test.ts
node --import tsx --input-type=module <<'EOF'
import { auditShippedGithubInvocationBoundary } from './src/engine/github-invocation-audit.ts';

const findings = auditShippedGithubInvocationBoundary(process.cwd());
if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}:${finding.column}: ${finding.message}`);
  }
  process.exit(1);
}
EOF
