// `conduct task start <id>` and `conduct task done <id>` — CLI for the
// task-driven pipeline. Starts or marks a task as done interactively or
// from automation.
//
// Mirrors the derive-feedback-cli.ts pattern: detected before the interactive
// pipeline boots, pure parsing (no I/O), returns dispatch type or null.

export type TaskDispatch = { kind: 'start'; id: string } | { kind: 'done'; id: string } | { kind: 'guide' };

/**
 * Parse argv for the `task` subcommand.
 *   conduct task start <id>      → {kind:'start', id:'<id>'}
 *   conduct task done <id>       → {kind:'done', id:'<id>'}
 *   conduct task [malformed]     → {kind:'guide'}
 *   (any other sub)              → null
 */
export function detectTaskCommand(argv: string[]): TaskDispatch | null {
  if (argv[2] !== 'task') return null;

  const verb = argv[3];
  const id = argv[4];

  // Missing or unknown verb
  if (!verb || (verb !== 'start' && verb !== 'done')) {
    return { kind: 'guide' };
  }

  // Missing or empty id
  if (!id) {
    return { kind: 'guide' };
  }

  return { kind: verb, id };
}

/**
 * Dispatch the `task` subcommand. Prints guide text or handles the task
 * start/done operations. (Future: this will coordinate with task-status.json)
 *
 * Exit codes:
 *   0 = success
 *   2 = usage/guide
 */
export async function dispatchTaskCommand(cmd: TaskDispatch, cwd: string): Promise<number> {
  if (cmd.kind === 'guide') {
    console.error(
      'conduct task start <id>\n' +
        '  Start or resume task <id> (H9 grammar [A-Za-z0-9._-]+). Prompts for\n' +
        '  confirmation and updates task-status.json.\n' +
        '\n' +
        'conduct task done <id>\n' +
        '  Mark task <id> as complete. Updates task-status.json and prints\n' +
        '  a completion summary.',
    );
    return 2;
  }

  // TODO: Implement task start/done logic
  // For now, just acknowledge the command
  console.log(`Task ${cmd.kind}: ${cmd.id}`);
  return 0;
}
