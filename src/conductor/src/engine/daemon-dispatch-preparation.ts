import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Clear provider-session markers before a daemon dispatch or re-dispatch. */
export async function preparePipelineForDaemonDispatch(
  pipelineDir: string,
): Promise<void> {
  await rm(join(pipelineDir, 'session-created'), { force: true });
}
