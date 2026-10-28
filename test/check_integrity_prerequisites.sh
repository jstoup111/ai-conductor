#!/usr/bin/env bash
# Covers: task:5
set -uo pipefail

# check_integrity_prerequisites.sh — Fails closed when a model-table integrity
# check lacks its local dependency tree or jq. The node mode guards checks 5a,
# 5b, and 5c; jq mode additionally guards check 5b's JSON comparison.
#
# Environment seam (for fixture tests):
#   HARNESS_INTEGRITY_CONDUCTOR_DIR — conductor directory that must contain
#                                      node_modules/ (defaults to src/conductor)
#
# Usage: bash test/check_integrity_prerequisites.sh <node|jq>
# Exit:  0 = requested prerequisite is available
#        1 = requested prerequisite is unavailable or mode is invalid

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
conductor_dir="${HARNESS_INTEGRITY_CONDUCTOR_DIR:-${HARNESS_DIR}/src/conductor}"
mode=${1:-}

case "$mode" in
  node)
    if [ -d "${conductor_dir}/node_modules" ]; then
      exit 0
    fi
    echo "Missing src/conductor/node_modules; run npm ci in src/conductor before running integrity model-table checks."
    exit 1
    ;;
  jq)
    if command -v jq >/dev/null 2>&1; then
      exit 0
    fi
    echo "Missing jq; install jq before running the model-table pin integrity check."
    exit 1
    ;;
  *)
    echo "Usage: bash test/check_integrity_prerequisites.sh <node|jq>" >&2
    exit 1
    ;;
esac
