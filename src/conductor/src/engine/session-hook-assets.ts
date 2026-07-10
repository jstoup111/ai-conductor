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
 * from stdin and exits 0 (no-op skeleton — behavior added in later tasks).
 */
export const PRE_DISPATCH_HOOK = [
  '#!/bin/bash',
  'set -e',
  '',
  '# Bound stdin read to 1MiB to avoid hanging or OOMing on a runaway payload',
  'PAYLOAD="$(head -c 1048576)"',
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
