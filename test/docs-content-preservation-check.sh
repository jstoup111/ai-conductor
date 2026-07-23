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
  "pre-dispatch.sh|docs/observability.md (session-hook task stamping)"
  "Intake-Issue Shape|docs/intake.md (Intake-Issue Shape: WHAT vs. HOW)"

  # docs/configuration.md — 5 relocated subsections (Story 3)
  "harness_version|docs/configuration.md (Full reference)"
  "model_fallback_ladder|docs/configuration.md (Model fallback ladder)"
  "spec_owner|docs/configuration.md (Operator identity & owner gate)"
  "SelfHostDetector|docs/configuration.md (Harness self-host guardrails)"
  "kind: llm_provider|docs/configuration.md (Plugins)"

  # docs/daemon-operations.md — 7 relocated subsections actually present
  # (of the 9 named in Story 3; Sandbox auth-expiry and Daemon build-auth
  # landed under docs/configuration.md instead)
  "halt-issues sweep|docs/daemon-operations.md (halt-issues sweep)"
  "advisory unmerged-dependent-work scan|docs/daemon-operations.md (overlap-scan)"
  "Mixed or malformed labels are ignored (safe-fail)|docs/daemon-operations.md (Priority scheduling)"
  "thundering herd|docs/daemon-operations.md (Rate-Limit Episode Coordination)"
  "conductor:needs-remediation|docs/daemon-operations.md (Halt-PR presentation reliability)"
  "Claim-time delivery guard (auto-healing duplicate dispatch)|docs/daemon-operations.md (Claim-time delivery guard and recovery)"
  "brain loop already running.|docs/daemon-operations.md (Brain Loop Supervision)"

  # docs/architecture.md — 3 relocated areas (Story 3)
  "Skills (24 total)|docs/architecture.md (How It Works)"
  "Engine / Execution / UI|docs/architecture.md (TypeScript Conductor)"
  "Stable bash SDLC runner|docs/architecture.md (Project Structure)"
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
