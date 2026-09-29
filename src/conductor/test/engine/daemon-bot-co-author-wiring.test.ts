import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
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

  it('keeps resolver installation out of every operator-facing source entry point', async () => {
    const engine = join(process.cwd(), 'src/engine');
    const entries = await readdir(engine, { recursive: true });
    const matches = await Promise.all(entries.filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts') && entry !== 'bot-co-author.ts').map(async entry => {
      const path = join(engine, entry);
      return (await readFile(path, 'utf8')).includes('installDaemonBotCoAuthor(') ? entry : undefined;
    }));
    expect(matches.filter(Boolean)).toEqual([]);
  });
});
