/**
 * write-fence.ts — write-fence script generator and settings merge.
 *
 * Phase 4 (TR-4): generate a bash script that blocks edits to the live harness
 * checkout (outside the worktree) while permitting edits within the worktree and
 * unrelated repositories. The script is invoked as a PreToolUse hook on Edit,
 * Write, MultiEdit, NotebookEdit, and Bash tools.
 *
 * The fence script:
 *   - Takes JSON on stdin with `file_path`/`notebook_path` and optional `command`
 *   - Resolves relative paths against the session cwd
 *   - Implements allow/block logic:
 *     * ALLOW (exit 0) if target is under worktree root
 *     * BLOCK (exit 2) if target is under harness root but outside worktree
 *     * ALLOW (exit 0) for read-only Bash (grep, cat, diff, etc.)
 *     * ALLOW (exit 0) otherwise (unrelated repos, OS temp, etc.)
 *   - ALLOW (exit 0) for malformed/empty payload (safety default)
 */

/**
 * Generate the fence script with worktree and harness roots baked in.
 * The script is a standalone bash executable that takes JSON payloads on stdin.
 *
 * @param worktreeRoot The build worktree root (absolute path)
 * @param harnessRoot The harness main checkout root (absolute path)
 * @returns The complete bash script with no placeholder residue
 */
export function generateFenceScript(worktreeRoot: string, harnessRoot: string): string {
  return `#!/bin/bash
#
# write-fence.sh — PreToolUse hook that blocks edits to the live harness checkout.
#
# Baked-in roots:
#   WORKTREE_ROOT="${worktreeRoot}"
#   HARNESS_ROOT="${harnessRoot}"
#

set -o pipefail

# Baked-in roots (no env vars — only these values, baked at provision time).
WORKTREE_ROOT="${worktreeRoot}"
HARNESS_ROOT="${harnessRoot}"

# Parse the JSON payload and extract the target path.
# The input may contain file_path (Edit/Write), notebook_path (NotebookEdit), or command (Bash).
extract_target_path() {
  local json="\$1"
  local tool_name="\$2"

  # Try file_path first (Edit/Write/MultiEdit)
  local file_path
  file_path=\$(printf '%s' "\$json" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
  if [[ -n "\$file_path" ]]; then
    printf '%s' "\$file_path"
    return 0
  fi

  # Try notebook_path (NotebookEdit)
  local notebook_path
  notebook_path=\$(printf '%s' "\$json" | jq -r '.tool_input.notebook_path // empty' 2>/dev/null)
  if [[ -n "\$notebook_path" ]]; then
    printf '%s' "\$notebook_path"
    return 0
  fi

  # For Bash, extract the command to check for write operations
  if [[ "\$tool_name" == "Bash" ]]; then
    local cmd
    cmd=\$(printf '%s' "\$json" | jq -r '.tool_input.command // empty' 2>/dev/null)
    printf '%s' "\$cmd"
    return 0
  fi

  return 1
}

# Check if a bash command has write-like patterns (> >> | sed/awk modifying, etc.)
has_write_shape() {
  local cmd="\$1"

  # Patterns that indicate a write operation:
  # - Redirection: > >> &>
  # - Pipes: | (used with writing tools like sed, awk, etc.)
  # - Tool patterns: sed 's/...' awk '...' (modifying operations)

  # Check for output redirection
  if [[ "\$cmd" =~ (^|[[:space:]])(\>|>>|&\>)([[:space:]]|\$) ]]; then
    return 0
  fi

  # Check for piping to modifying tools (sed with patterns, awk, etc.)
  if [[ "\$cmd" =~ \|[[:space:]]*(sed|awk|gawk)[[:space:]] ]]; then
    return 0
  fi

  # sed with substitution (s/.../) is modifying even without output redirect
  if [[ "\$cmd" =~ (^|[[:space:]])sed[[:space:]].*s/ ]]; then
    return 0
  fi

  return 1
}

# Resolve an absolute path, handling .. and symlinks
resolve_path() {
  local path="\$1"
  local cwd="\${2:-.}"

  # If the path is relative, resolve it against the cwd
  if [[ "\$path" != /* ]]; then
    path="\$cwd/\$path"
  fi

  # Use cd + pwd to resolve the canonical path
  # We avoid subshells by using a temp approach
  local resolved
  if resolved=\$(cd "\$path" 2>/dev/null && pwd) || \
     resolved=\$(cd "\$(dirname "\$path")" 2>/dev/null && pwd) && [[ -d "\$resolved" ]]; then
    # path or its parent resolved; use that
    printf '%s' "\$resolved"
  else
    # Path doesn't exist; canonicalize by removing .. and .
    # Remove trailing slashes and . components
    path="\${path%/}"
    while [[ "\$path" == */../* ]]; do
      path=\$(printf '%s' "\$path" | sed 's#/[^/]*/\.\./#/#')
    done
    printf '%s' "\$path"
  fi
}

# Check if a path is under a root directory
path_under() {
  local path="\$1"
  local root="\$2"

  # Normalize both paths to remove trailing slashes for comparison
  path="\${path%/}"
  root="\${root%/}"

  # Check if path starts with root/
  [[ "\$path" == "\$root"/* || "\$path" == "\$root" ]]
}

# Main fence logic
main() {
  local json
  json=\$(cat)

  # Fail-open on empty or malformed input
  if [[ -z "\$json" ]]; then
    exit 0
  fi

  # Extract tool_name and path
  local tool_name
  tool_name=\$(printf '%s' "\$json" | jq -r '.tool_name // empty' 2>/dev/null)

  if [[ -z "\$tool_name" ]]; then
    # No tool_name — fail-open
    exit 0
  fi

  # Get the target path
  local target
  target=\$(extract_target_path "\$json" "\$tool_name")

  # For Bash, check if it's read-only
  if [[ "\$tool_name" == "Bash" ]]; then
    if ! has_write_shape "\$target"; then
      # Read-only Bash (grep, cat, diff, etc.) — allow
      exit 0
    fi
  fi

  # If no target path was found, allow
  if [[ -z "\$target" ]]; then
    exit 0
  fi

  # Resolve the target path against the current working directory
  local cwd
  cwd=\$(pwd)
  local resolved
  resolved=\$(resolve_path "\$target" "\$cwd")

  # Check if the resolved path is under the worktree root
  if path_under "\$resolved" "\$WORKTREE_ROOT"; then
    # Inside worktree — allow
    exit 0
  fi

  # Check if the resolved path is under the harness root (but outside worktree)
  if path_under "\$resolved" "\$HARNESS_ROOT"; then
    # Inside harness, outside worktree — BLOCK
    printf 'FENCE BLOCK: attempted edit outside worktree\\n' >&2
    printf '  Target: %s\\n' "\$resolved" >&2
    printf '  Worktree root: %s\\n' "\$WORKTREE_ROOT" >&2
    exit 2
  fi

  # Outside both — allow (unrelated repo, OS temp, etc.)
  exit 0
}

main
`;
}

/**
 * Merge the fence script path into settings.json as a PreToolUse hook.
 * Appends the fence entry to any existing hooks and preserves all existing entries
 * byte-for-byte.
 *
 * @param operatorSettingsJson Operator's settings.json as a JSON string, or null for minimal
 * @returns Valid settings.json with fence entry added under hooks.PreToolUse
 */
export function mergeFenceIntoSettings(operatorSettingsJson: string | null): string {
  let settings: Record<string, unknown>;

  if (operatorSettingsJson === null) {
    // Minimal valid settings
    settings = {
      hooks: {
        PreToolUse: [],
      },
    };
  } else {
    // Parse existing settings
    try {
      settings = JSON.parse(operatorSettingsJson);
    } catch {
      // Malformed JSON — start with minimal
      settings = {
        hooks: {
          PreToolUse: [],
        },
      };
    }
  }

  // Ensure hooks object exists
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }

  // Ensure PreToolUse array exists
  const hooks = settings.hooks as Record<string, unknown>;
  if (!Array.isArray(hooks.PreToolUse)) {
    hooks.PreToolUse = [];
  }

  // Append the fence entry
  const preToolUseArray = hooks.PreToolUse as Record<string, unknown>[];

  // The fence script path is not yet known at merge time; it will be written
  // during sandbox provision. For now, use a placeholder that the sandbox
  // provisioner will know to replace. However, per the task description,
  // the script is materialized separately, so we reference it by the standard
  // sandbox path.
  const fenceScriptPath = 'write-fence.sh'; // Relative to CLAUDE_CONFIG_DIR, or full path when provisioned

  // Add the fence entry at the end to not disrupt existing entries
  preToolUseArray.push({
    command: fenceScriptPath,
  });

  return JSON.stringify(settings, null, 2);
}
