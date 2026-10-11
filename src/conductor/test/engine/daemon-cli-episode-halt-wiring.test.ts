// Covers: task:11
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const daemonCliSource = join(__dirname, '../../src/daemon-cli.ts');

describe('daemon-cli durable episode HALT tracker wiring', () => {
  it('constructs the tracker over the daemon worktree base with its diagnostic sink', async () => {
    const source = await readFile(daemonCliSource, 'utf8');
    expect(source).toMatch(/createEpisodeHaltTracker\(\{\s*worktreeBase,\s*log\s*\}\)/);
  });

  it('passes the active episode deadline to the durable stamp callback', async () => {
    const source = await readFile(daemonCliSource, 'utf8');
    expect(source).toMatch(
      /onHaltWritten:\s*async\s*\(slug, episodeCaused, deadlineMs\)[\s\S]*?episodeHaltTracker\.onHaltWritten\(slug, episodeCaused, deadlineMs\)/,
    );
  });

  it('uses the durable tracker scan as recoverEpisodeHalts stampedHalts source', async () => {
    const source = await readFile(daemonCliSource, 'utf8');
    expect(source).toMatch(/stampedHalts:\s*\(\)\s*=>\s*episodeHaltTracker\.listRecoverable\(Date\.now\(\)\)/);
  });
});
