import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../../src/', import.meta.url));

describe('production terminal-renderer wiring', () => {
  it('supplies renderer options from both configured entry points', async () => {
    const [cliSource, daemonSource] = await Promise.all([
      readFile(new URL('index.ts', `file://${sourceRoot}`), 'utf-8'),
      readFile(new URL('daemon-cli.ts', `file://${sourceRoot}`), 'utf-8'),
    ]);

    expect(cliSource).toMatch(
      /registerCliBuiltins\(registry, events, renderEvent, config, rendererOpts\)/,
    );
    expect(daemonSource).toMatch(
      /registerBuiltins\(registry, events, \(event\) => \{[\s\S]*?\}, rendererOpts, config\?\.codex_doctor_timeout_seconds\)/,
    );
  });
});
