// Covers: task:5
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { materializePiHarnessExtension } from '../../src/execution/pi-harness-extension.js';
import { createFakeExtensionApi, loadExtensionFactory } from './support/fake-pi-extension-api.js';

const schema = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['pass', 'fail'] } },
  required: ['verdict'],
  additionalProperties: false,
};

describe('harness extension submit_result', () => {
  let home: string;
  let schemaFile: string;
  let factory: Awaited<ReturnType<typeof loadExtensionFactory>>;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pi-submit-result-'));
    schemaFile = join(home, 'schema.json');
    await writeFile(schemaFile, JSON.stringify(schema));
    factory = await loadExtensionFactory(await materializePiHarnessExtension({ homeDir: home }));
  });
  afterEach(async () => { await rm(home, { recursive: true, force: true }); });

  it('registers submit_result with the schema file as parameters when the flag names it', async () => {
    const fake = createFakeExtensionApi({ 'conduct-output-schema': schemaFile });

    await factory(fake.api);

    expect(fake.registeredFlags).toEqual(['conduct-output-schema']);
    expect(fake.tools.map((tool) => tool.name)).toEqual(['submit_result']);
    expect(fake.tools[0]!.parameters).toEqual(schema);
  });

  it('returns the params from the second execute argument as details and terminates', async () => {
    const fake = createFakeExtensionApi({ 'conduct-output-schema': schemaFile });
    await factory(fake.api);

    const result = await fake.tools[0]!.execute('call-1', { verdict: 'pass' }, undefined, undefined, { cwd: home });

    expect(result.details).toEqual({ verdict: 'pass' });
    expect(result.terminate).toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
  });

  it('registers no tool when no harness flag is set', async () => {
    const fake = createFakeExtensionApi();

    await factory(fake.api);

    expect(fake.tools).toEqual([]);
  });
});
