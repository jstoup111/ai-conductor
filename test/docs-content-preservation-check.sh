#!/usr/bin/env bash
# Zero-loss distinctive-string check: verifies that a curated set of
# distinctive strings — one per relocated README section, drawn from the
# pre-change README baseline (commit 4c0d639e^) — is still present somewhere
# under docs/. Guards against content silently dropped during the
# README-condense / docs-relocate rewrite (see
# .docs/plans/condense-readme-relocate-docs.md, Task 13).
#
# Usage:
#   test/docs-content-preservation-check.sh              # check the real repo docs/
#   test/docs-content-preservation-check.sh <root-dir>    # check docs under an arbitrary root
set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DOCS_DIR="$ROOT/docs"

# Curated list: "<distinctive string>|<relocated section / expected home>"
STRINGS=(
  "unknown-command guard|docs/choosing-a-conductor.md (Choosing a Conductor)"
  "npm install && npm run build|docs/getting-started.md (Install)"
  "OTLP HTTP|docs/configuration.md (OpenTelemetry config reference)"
  "halt-issues sweep|docs/daemon-operations.md (daemon subcommands)"
  "pre-dispatch.sh|docs/observability.md (session-hook task stamping)"
  "Intake-Issue Shape|docs/intake.md (Intake-Issue Shape: WHAT vs. HOW)"
  "Skills (24 total)|docs/architecture.md (How It Works)"
)

if [ ! -d "$DOCS_DIR" ]; then
  echo "docs-content-preservation-check: docs/ directory not found under $ROOT" >&2
  exit 2
fi

FAIL=0
for entry in "${STRINGS[@]}"; do
  needle="${entry%%|*}"
  label="${entry#*|}"
  if grep -rlF -- "$needle" "$DOCS_DIR" >/dev/null 2>&1; then
    echo "PASS: found '$needle' under docs/ (expected: $label)"
  else
    echo "FAIL: '$needle' not found anywhere under docs/ (expected: $label)" >&2
    FAIL=1
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo "docs-content-preservation-check: one or more distinctive strings missing from docs/" >&2
  exit 1
fi

echo "docs-content-preservation-check: all distinctive strings preserved under docs/"
exit 0
