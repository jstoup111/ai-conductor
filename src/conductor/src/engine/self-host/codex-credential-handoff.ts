import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Tracks only a credential destination this handoff successfully created. */
export function createCredentialHandoff(args: { homeDir: string }) {
  let created: string | undefined;
  let tornDown = false;
  return {
    recordCreated(path: string): void {
      const expected = join(args.homeDir, 'auth.json');
      if (path !== expected) throw new Error('Credential handoff destination escaped its isolated home.');
      created = path;
    },
    async teardown(): Promise<void> {
      if (tornDown) return;
      tornDown = true;
      if (created) await rm(created, { force: true });
    },
  };
}
