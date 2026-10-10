import { createInterface } from 'node:readline/promises';

import type {
  GithubOperationApprovalPrompt,
  InteractiveGithubOperationConfirmation,
} from './github-operation-approval.js';
import { formatGithubOperationTarget, type GithubOperationTarget } from './github-operations.js';

export interface TerminalGithubOperationConfirmationIo {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  readonly isTerminal?: () => boolean;
}

/** Create the terminal-only approval boundary for one guarded GitHub write. */
export function createTerminalGithubOperationConfirmation(
  io: TerminalGithubOperationConfirmationIo = {},
): InteractiveGithubOperationConfirmation {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const isTerminal = io.isTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));

  return {
    mode: 'interactive',
    confirm: async (prompt: GithubOperationApprovalPrompt): Promise<boolean> => {
      if (!isTerminal()) return false;
      const target: GithubOperationTarget = prompt.target;
      const readline = createInterface({ input, output });
      try {
        const answer = await readline.question(
          `Authorize ${prompt.operation} on ${formatGithubOperationTarget(target)}? [y/N] `,
        );
        return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
      } finally {
        readline.close();
      }
    },
  };
}
