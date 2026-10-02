import { createHash } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Pi loads extensions as TypeScript.  Keep this self-contained: it is copied
 * into the harness home, never into a project .pi directory.
 */
export const PI_HARNESS_EXTENSION_SOURCE = String.raw`
export default function(pi: any) {
  const schemaPath = pi.registerFlag('conduct-output-schema', { type: 'string' });
  const path = pi.getFlag(schemaPath);
  if (path) {
    // The provider permits async extension factories; avoid a static dependency so this
    // engine-owned asset remains one self-contained source string.
    return import('node:fs/promises').then((fs: any) => fs.readFile(path, 'utf8').then((raw: string) =>
      pi.registerTool({ name: 'submit_result', description: 'Submit the final structured result.', parameters: JSON.parse(raw), async execute(args: any) { return { details: args, terminate: true }; } })));
  }
}
`;

export interface MaterializePiHarnessExtensionOptions { readonly homeDir?: string; }

export async function materializePiHarnessExtension(
  options: MaterializePiHarnessExtensionOptions = {},
): Promise<string> {
  const prefix = createHash('sha256').update(PI_HARNESS_EXTENSION_SOURCE).digest('hex').slice(0, 16);
  const target = resolve(options.homeDir ?? homedir(), '.ai-conductor', 'pi', `harness-extension-${prefix}.ts`);
  await mkdir(dirname(target), { recursive: true });
  try {
    if ((await stat(target)).isFile()) {
      const existing = await import('node:fs/promises').then(({ readFile }) => readFile(target, 'utf8'));
      if (existing === PI_HARNESS_EXTENSION_SOURCE) return target;
    }
  } catch (error: any) { if (error?.code !== 'ENOENT') throw new Error(`could not materialize provider harness extension at ${target}: ${error.message}`); }
  const temporary = join(dirname(target), `.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try { await writeFile(temporary, PI_HARNESS_EXTENSION_SOURCE, 'utf8'); await rename(temporary, target); }
  catch (error: any) { throw new Error(`could not materialize provider harness extension at ${target}: ${error.message}`); }
  return target;
}
