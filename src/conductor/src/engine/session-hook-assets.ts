/**
 * Session-lifecycle hook scripts embedded as engine assets
 *
 * Both hooks are written to .pipeline/session-hooks/ at worktree provisioning
 * and wired via settings.json hook entries. They use only bash and POSIX
 * tools — no dist references, no conduct-ts invocations. stdin is bounded
 * via `head -c` so a runaway payload can never hang or OOM the hook.
 */

/**
 * PreToolUse-style dispatch hook (pre-dispatch)
 * Invoked before a subagent is dispatched. Reads the bounded hook payload
 * from stdin, extracts line 1 of `tool_input.prompt`, and passes through
 * (exit 0, no state touched) when it is exactly "Task: none". Further
 * behavior for real task ids is added in later tasks.
 */
export const PRE_DISPATCH_HOOK = [
  '#!/bin/bash',
  'set -e',
  '',
  '# Bound stdin read to 1MiB to avoid hanging or OOMing on a runaway payload',
  'PAYLOAD="$(head -c 1048576)"',
  '',
  '# Extract line 1 of tool_input.prompt via a bounded node JSON parse. A',
  '# malformed/missing prompt yields an empty LINE1, which simply falls',
  '# through to the (currently no-op) tail of the hook.',
  'LINE1="$(printf \'%s\' "$PAYLOAD" | node -e \'',
  'let data = "";',
  'process.stdin.on("data", (chunk) => { data += chunk; });',
  'process.stdin.on("end", () => {',
  '  try {',
  '    const payload = JSON.parse(data);',
  '    const prompt = payload && payload.tool_input && payload.tool_input.prompt;',
  '    if (typeof prompt === "string") {',
  '      process.stdout.write(prompt.split("\\n")[0]);',
  '    }',
  '  } catch (err) {',
  '    // Malformed payload — emit nothing, let the caller fall through.',
  '  }',
  '});',
  '\' 2>/dev/null || true)"',
  '',
  '# Task: none — pass through without touching any pipeline state.',
  'if [ "$LINE1" = "Task: none" ]; then',
  '  exit 0',
  'fi',
  '',
  'exit 0',
].join('\n');

/**
 * PostToolUse-style dispatch hook (post-dispatch)
 * Invoked after a subagent dispatch completes. Reads the bounded hook
 * payload from stdin and exits 0 (no-op skeleton — behavior added in later
 * tasks).
 */
export const POST_DISPATCH_HOOK = [
  '#!/bin/bash',
  'set -e',
  '',
  '# Bound stdin read to 1MiB to avoid hanging or OOMing on a runaway payload',
  'PAYLOAD="$(head -c 1048576)"',
  '',
  'exit 0',
].join('\n');
