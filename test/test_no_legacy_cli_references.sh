#!/usr/bin/env bash
set -euo pipefail

# Legacy CLI reference guard. The retired binary may appear only where this
# deprecation window explicitly documents its alias relationship.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

failures=0
if command -v rg >/dev/null 2>&1; then
  scanner=rg
elif command -v grep >/dev/null 2>&1; then
  scanner=grep
else
  printf 'legacy CLI reference guard: scanners rg and grep are unavailable\n' >&2
  exit 1
fi

set +e
if [ "$scanner" = rg ]; then
  scan_output=$(cd "$HARNESS_DIR" && rg -n --no-heading --fixed-strings 'conduct-ts' \
    --glob '!bin/ai-conductor' \
    --glob '!bin/conduct' \
    --glob '!bin/update' \
    src/conductor/src hooks skills bin README.md HARNESS.md docs/reference/cli.md docs/reference/skills.md)
else
  scan_output=$(cd "$HARNESS_DIR" && grep -rInH --fixed-strings --exclude-dir=node_modules 'conduct-ts' \
    src/conductor/src hooks skills bin README.md HARNESS.md docs/reference/cli.md docs/reference/skills.md)
fi
scan_exit=$?
set -e

case "$scan_exit" in
  0) ;;
  1) scan_output='' ;;
  *)
    printf 'legacy CLI reference guard: %s scan failed (exit %s)\n' "$scanner" "$scan_exit" >&2
    exit "$scan_exit"
    ;;
esac

while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  path=${hit%%:*}
  remainder=${hit#*:}
  text=${remainder#*:}

  case "$path:$text" in
    # Installed binary alias symlink chain.
    'src/conductor/src/index.ts:// installed layout can be a symlink chain (~/.local/bin/conduct-ts →')
      ;;
    # Installed binary alias symlink chain target.
    'src/conductor/src/index.ts:// <harness>/bin/conduct-ts → <harness>/src/conductor/dist/index.js).')
      ;;
    # Direct-execution guard names the deprecated launcher path.
    'src/conductor/src/index.ts:// bin/conduct-ts) — NOT when imported (e.g. by tests importing `deriveMode`).')
      ;;
    # The compatibility `engineer` verb remains explicitly documented as an alias.
    src/conductor/src/engine/engineer-cli.ts:*'conduct-ts engineer'*'deprecated alias.'*)
      ;;
    # The canonical launcher's own compatibility warning is necessarily named
    # after the deprecated invocation.
    'bin/conduct-ts:')
      ;;
    # These three scripts implement the retired command's compatibility layer.
    # They remain excluded from this scanner while the alias is supported; the
    # installer and every other bin/ entry are scanned normally.
    bin/conduct:*|bin/update:*|bin/ai-conductor:*)
      ;;
    # --check verifies the installed compatibility alias is still reachable;
    # this is an operator-facing PATH health probe, not an internal invocation.
    'bin/install:  # Check conduct-ts (TypeScript conductor). The bundle is built from')
      ;;
    # The check result identifies the alias the preceding PATH probe checked.
    'bin/install:  # conduct-ts is the engine every harness command runs through, so neither of')
      ;;
    # The check result documents why a missing compatibility alias is a failure.
    'bin/install:  # `--check` exit 0 with conduct-ts entirely absent and told the')
      ;;
    # The install failure ledger records the missing compatibility alias by name.
    'bin/install:# conduct-ts entirely absent.')
      ;;
    # The compatibility alias PATH probe itself is intentionally operator-facing.
    'bin/install:    if command -v conduct-ts &>/dev/null; then')
      ;;
    # The compatibility alias PATH probe reports its exact installed command.
    'bin/install:      ok "conduct-ts built and on PATH ($(which conduct-ts))"')
      ;;
    # The compatibility alias PATH probe names its repair command when missing.
    'bin/install:      fail "conduct-ts bundle built but not on PATH — run ./bin/install"')
      ;;
    # The check result labels the deprecated alias's missing bundle accurately.
    'bin/install:    fail "conduct-ts bundle not built — run ./bin/install (needs Node >=26; this repo pins nodejs 26.7.0 via .tool-versions)"')
      ;;
    # The canonical launcher's companion alias remains independently verifiable.
    'bin/install:  # built bundle as the deprecated conduct-ts alias, but must remain a')
      ;;
    # The build-auth alias probe guards the installed compatibility entrypoint.
    'bin/install:  if command -v conduct-ts &>/dev/null; then')
      ;;
    # All remaining command-v forms are similarly alias-health probes only.
    bin/install:*'command -v conduct-ts'* )
      ;;
    # The build-auth alias probe explains why it cannot diagnose an absent alias.
    'bin/install:    warn "build-auth check skipped — conduct-ts not on PATH"')
      ;;
    # Viewer configuration checks retain the alias-health probe before delegating.
    'bin/install:    if ! command -v conduct-ts &>/dev/null; then')
      ;;
    # Viewer configuration checks name the missing alias they just probed.
    'bin/install:      warn "markdown viewer configured but could not be read — conduct-ts not on PATH"')
      ;;
    # Renderer configuration checks retain the alias-health probe before delegating.
    'bin/install:      warn "mermaid renderer configured but could not be read — conduct-ts not on PATH"')
      ;;
    # The installer freshness guard's historic name is an explanatory comment.
    'bin/install:  # (e.g. the conduct-ts install-freshness guard) gate on the exit code.')
      ;;
    # Interactive viewer setup still detects an unavailable compatibility alias.
    'bin/install:    warn "conduct-ts is required to save the markdown viewer; install or restore it, then re-run bin/install"')
      ;;
    # Interactive renderer setup still detects an unavailable compatibility alias.
    'bin/install:    warn "conduct-ts is required to save the mermaid renderer; install or restore it, then re-run bin/install"')
      ;;
    # The following build and link messages describe the supported legacy alias.
    'bin/install:# ─── conduct-ts build ─────────────────────────────────────────────────────────')
      ;;
    'bin/install:  # 3. Build conduct-ts (npm ci + npm run build) so the dist bundle reflects')
      ;;
    'bin/install:# Return 0 if the active Node satisfies conduct-ts'"'"'s >=26 requirement. The repo')
      ;;
    'bin/install:  echo -e "${BOLD}conduct-ts${NC}"')
      ;;
    'bin/install:    warn "src/conductor/package.json missing — skipping conduct-ts build"')
      ;;
    'bin/install:  # 3a. Build conduct-ts (npm ci + npm run build) so the dist bundle reflects')
      ;;
    'bin/install:  # 3b. Symlink conduct-ts (TypeScript conductor) if the dist bundle exists.')
      ;;
    bin/install:*'conduct-ts bundle'*|bin/install:*'conduct-ts dependencies'*|bin/install:*'conduct-ts requires Node'*|bin/install:*'build conduct-ts'*|bin/install:*'build conduct_ts'*|bin/install:*'cannot build conduct-ts'*|bin/install:*'conduct-ts not built'*|bin/install:*'conduct-ts not installed'*|bin/install:*'conduct-ts symlink'*|bin/install:*'conduct-ts script'*|bin/install:*'conduct-ts is the engine-layer'*|bin/install:*'invoking `conduct-ts` explicitly.'*|bin/install:*'conduct-ts symlink cannot'*|bin/install:*'Installation incomplete — conduct-ts was not installed.'*|bin/install:*'CONDUCT_TS_FAILURE'*|bin/install:*'node_supports_conduct_ts'*|bin/install:*'build_conduct_ts'*|bin/install:*'local conduct_ts_'*|bin/install:*'current_ts='*|bin/install:*'${HARNESS_DIR}/bin/conduct-ts'*|bin/install:*'${LOCAL_BIN}/conduct-ts'*|bin/install:*'Skills, permissions and hooks are installed and usable, but conduct-ts is'*|bin/install:*'whole failed. Restate the cause here: the diagnosis in the conduct-ts'*)
      ;;
    bin/install:*'for entrypoint in conduct conduct-ts ai-conductor'*|bin/install:*'conduct-ts) expected_source'*)
      ;;
    *)
      printf 'non-allowlisted conduct-ts reference: %s\n' "$hit" >&2
      failures=1
      ;;
  esac
done <<< "$scan_output"

set +e
if [ "$scanner" = rg ]; then
  removed_cli_output=$(cd "$HARNESS_DIR" && rg -n --no-heading --fixed-strings 'bin/conduct' src/conductor/src hooks skills bin README.md HARNESS.md docs/reference/cli.md docs/reference/skills.md)
else
  removed_cli_output=$(cd "$HARNESS_DIR" && grep -rInH --fixed-strings --exclude-dir=node_modules 'bin/conduct' src/conductor/src hooks skills bin README.md HARNESS.md docs/reference/cli.md docs/reference/skills.md)
fi
removed_cli_exit=$?
set -e

case "$removed_cli_exit" in
  0) ;;
  1) removed_cli_output='' ;;
  *)
    printf 'legacy CLI reference guard: %s removed-CLI scan failed (exit %s)\n' "$scanner" "$removed_cli_exit" >&2
    exit "$removed_cli_exit"
    ;;
esac

while IFS= read -r hit; do
  [ -n "$hit" ] || continue
  path=${hit%%:*}
  remainder=${hit#*:}
  text=${remainder#*:}

  case "$text" in
    *bin/conduct-ts*) continue ;;
  esac

  case "$path" in
    src/conductor/src/engine/self-host/release-gate.ts|src/conductor/src/engine/self-host/version-signal.ts)
      ;;
    *)
      printf 'non-allowlisted bin/conduct reference: %s\n' "$hit" >&2
      failures=1
      ;;
  esac
done <<< "$removed_cli_output"

if [ "$failures" -ne 0 ]; then
  exit 1
fi

printf 'legacy CLI reference guard: PASS\n'
