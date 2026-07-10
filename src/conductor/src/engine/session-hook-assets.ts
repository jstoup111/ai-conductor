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
  '# Task: <id> — flip the row to in_progress in task-status.json and stamp',
  '# .pipeline/current-task with the id. Extraction is bounded to the H9 id',
  '# grammar so trailing prose after the id never matches.',
  'if [[ "$LINE1" =~ ^Task:\\ ([A-Za-z0-9._-]+|none)$ ]]; then',
  '  TASK_ID="${BASH_REMATCH[1]}"',
  '  if [ "$TASK_ID" != "none" ]; then',
  '    node -e \'',
  'const { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } = require("fs");',
  'const { join } = require("path");',
  'const id = process.argv[1];',
  'const pipelineDir = join(process.cwd(), ".pipeline");',
  'const statusPath = join(pipelineDir, "task-status.json");',
  'let raw;',
  'try {',
  '  raw = readFileSync(statusPath, "utf-8");',
  '} catch (err) {',
  '  process.exit(0);',
  '}',
  'let parsed;',
  'try {',
  '  parsed = JSON.parse(raw);',
  '} catch (err) {',
  '  process.exit(0);',
  '}',
  'if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tasks)) {',
  '  process.exit(0);',
  '}',
  'const row = parsed.tasks.find((t) => t && t.id === id);',
  'if (!row) {',
  '  process.exit(0);',
  '}',
  'row.status = "in_progress";',
  'mkdirSync(pipelineDir, { recursive: true });',
  'const tempFile = join(pipelineDir, `.task-status.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);',
  'try {',
  '  writeFileSync(tempFile, JSON.stringify(parsed, null, 2));',
  '  renameSync(tempFile, statusPath);',
  '} catch (err) {',
  '  try { rmSync(tempFile, { force: true }); } catch (e) {}',
  '  process.exit(0);',
  '}',
  'writeFileSync(join(pipelineDir, "current-task"), id);',
  '\' "$TASK_ID" 2>/dev/null || true',
  '  fi',
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
