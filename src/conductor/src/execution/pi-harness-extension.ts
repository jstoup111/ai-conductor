import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Pi loads extensions as TypeScript.  Keep this self-contained: it is copied
 * into the harness home, never into a project .pi directory.
 */
export const PI_HARNESS_EXTENSION_SOURCE = String.raw`
export default function(pi: any) {
  pi.registerFlag('conduct-git-read', { type: 'boolean', default: false, description: 'Register the harness git_read tool.' });
  pi.registerFlag('conduct-output-schema', { type: 'string', description: 'Harness output schema file.' });
  const subcommands = ['show', 'diff', 'log', 'ls-tree', 'ls-files', 'cat-file', 'rev-parse', 'blame', 'grep'];
  // Options that write files or run another program (catalog D17). Long names refuse
  // their unambiguous abbreviations too, because git accepts abbreviated long options.
  const deniedOptions: Array<{ long: string; short?: string }> = [
    { long: '--output', short: 'O' },
    { long: '--open-files-in-pager' },
    { long: '--ext-diff' },
    { long: '--textconv' },
    { long: '--filters' },
    { long: '--show-signature' },
    { long: '--config-env', short: 'c' },
  ];
  const refused = (arg: string): string | undefined => {
    if (arg.startsWith('--')) {
      const name = arg.split('=', 1)[0];
      return name.length > 2 ? deniedOptions.find(({ long }) => long.startsWith(name))?.long : undefined;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const denied = deniedOptions.find(({ short }) => short !== undefined && arg.slice(1).includes(short));
      return denied?.short === undefined ? undefined : '-' + denied.short;
    }
    return undefined;
  };
  if (pi.getFlag('conduct-git-read') === true) {
    pi.registerTool({
      name: 'git_read',
      label: 'git read',
      description: 'Run an allowed read-only git command.',
      parameters: {
        type: 'object',
        required: ['subcommand', 'args'],
        properties: {
          subcommand: { type: 'string', enum: subcommands },
          args: { type: 'array', items: { type: 'string' } },
        },
      },
      // The host marks a tool result as an error only when execute throws.
      async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
        const subcommand = params?.subcommand;
        const args: string[] = Array.isArray(params?.args) ? params.args : [];
        if (!subcommands.includes(subcommand)) throw new Error('git_read subcommand not allowed: ' + String(subcommand));
        const bad = args.map(refused).find((option) => option !== undefined);
        if (bad !== undefined) throw new Error('git_read option not allowed: ' + bad);
        const env: Record<string, string | undefined> = { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat' };
        delete env.GIT_EXTERNAL_DIFF;
        // Module-free by contract (catalog D15): reach child_process through the runtime.
        const childProcess: any = process.getBuiltinModule('node:child_process');
        const stdout: string = await new Promise((resolve, reject) => {
          childProcess.execFile('git', [subcommand, ...args], { cwd: ctx?.cwd, shell: false, env, maxBuffer: 16 * 1024 * 1024 },
            (error: any, out: string, stderr: string) => {
              if (error) reject(new Error(String(stderr || error.message)));
              else resolve(String(out));
            });
        });
        return { content: [{ type: 'text', text: stdout }], details: {} };
      },
    });
  }
  const path = pi.getFlag('conduct-output-schema');
  if (typeof path !== 'string' || path === '') return;
  // Module-free by contract (catalog D15): reach node:fs through the runtime.
  const raw = process.getBuiltinModule('node:fs').readFileSync(path, 'utf8');
  pi.registerTool({
    name: 'submit_result',
    label: 'Submit result',
    description: 'Submit the final structured result.',
    parameters: JSON.parse(raw),
    async execute(_toolCallId: string, params: any) {
      return { content: [{ type: 'text', text: 'Result submitted.' }], details: params, terminate: true };
    },
  });
}
`;

export interface MaterializePiHarnessExtensionOptions {
  readonly homeDir?: string;
  /** Filesystem write seam; defaults to node:fs/promises writeFile. */
  readonly writeFile?: (path: string, data: string) => Promise<void>;
}

export async function materializePiHarnessExtension(
  options: MaterializePiHarnessExtensionOptions = {},
): Promise<string> {
  const prefix = createHash('sha256').update(PI_HARNESS_EXTENSION_SOURCE).digest('hex').slice(0, 16);
  const target = resolve(options.homeDir ?? homedir(), '.ai-conductor', 'pi', `harness-extension-${prefix}.ts`);
  await mkdir(dirname(target), { recursive: true });
  try {
    if ((await stat(target)).isFile()) {
      const existing = await readFile(target, 'utf8');
      if (existing === PI_HARNESS_EXTENSION_SOURCE) return target;
    }
  } catch (error: any) { if (error?.code !== 'ENOENT') throw new Error(`could not materialize provider harness extension at ${target}: ${error.message}`); }
  const temporary = join(dirname(target), `.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
  try { await (options.writeFile ?? ((path, data) => writeFile(path, data, 'utf8')))(temporary, PI_HARNESS_EXTENSION_SOURCE); await rename(temporary, target); }
  catch (error: any) { throw new Error(`could not materialize provider harness extension at ${target}: ${error.message}`); }
  // Verify the bytes Pi will load, not the bytes we meant to write (catalog D15).
  let written: string;
  try { written = await readFile(target, 'utf8'); }
  catch (error: any) { throw new Error(`could not materialize provider harness extension at ${target}: ${error.message}`); }
  if (written !== PI_HARNESS_EXTENSION_SOURCE) {
    throw new Error(`could not materialize provider harness extension at ${target}: written bytes do not match the harness source`);
  }
  return target;
}
