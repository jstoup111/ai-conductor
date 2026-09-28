import { readFile } from 'node:fs/promises';

import { AS_BUILT_REPORT_PATH } from '../../../src/conductor/src/engine/as-built-verdict-store.js';

export async function readVerdictMarkdown(worktree: string): Promise<string> {
  return readFile(`${worktree}/${AS_BUILT_REPORT_PATH}`, 'utf8');
}
