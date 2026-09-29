import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('daemon bot co-author wiring', () => {
  it('installs one production resolver on the daemon event emitter before dispatch setup', async () => {
    const source = await readFile(join(process.cwd(), 'src/daemon-cli.ts'), 'utf8');
    const emitter = source.indexOf('const events = new ConductorEventEmitter();');
    const install = source.indexOf('installDaemonBotCoAuthor(createBotCoAuthorResolver({ runner: makeProductionGh(), cwd: projectRoot, events }));');
    const dispatch = source.indexOf('makeRunFeature(');

    expect(emitter).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(emitter);
    expect(install).toBeLessThan(dispatch);
    expect(source.match(/installDaemonBotCoAuthor\(/g)).toHaveLength(1);
  });
});
