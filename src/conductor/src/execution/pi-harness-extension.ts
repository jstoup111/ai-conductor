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
  const gitRead = pi.registerFlag('conduct-git-read', { type: 'boolean', default: false });
  const schemaPath = pi.registerFlag('conduct-output-schema', { type: 'string' });
  const deniedOptions = [
    { long: '--output', short: 'O' },
    { long: '--open-files-in-pager' },
    { long: '--ext-diff' },
    { long: '--textconv' },
    { long: '--config-env', short: 'c' },
  ];
  const refused = (arg: string) => {
    if (arg.startsWith('--')) {
      const name = arg.split('=', 1)[0];
      return name.length > 2 && deniedOptions.find(({ long }) => long.startsWith(name))?.long;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const denied = deniedOptions.find(({ short }) => short && arg.slice(1).includes(short));
      return denied?.short && '-' + denied.short;
    }
  };
  if (pi.getFlag(gitRead)) {
    pi.registerTool({ name: 'git_read', description: 'Run an allowed read-only git command', parameters: {
      type: 'object', required: ['subcommand', 'args'], properties: {
        subcommand: { type: 'string', enum: ['show','diff','log','ls-tree','ls-files','cat-file','rev-parse','blame','grep'] },
        args: { type: 'array', items: { type: 'string' } },
      },
    }, async execute(args: any, context: any) {
      if (!['show','diff','log','ls-tree','ls-files','cat-file','rev-parse','blame','grep'].includes(args.subcommand)) return { isError: true, content: [{ type: 'text', text: 'subcommand not allowed: ' + args.subcommand }] };
      const bad = (args.args || []).map(refused).find(Boolean);
      if (bad) return { isError: true, content: [{ type: 'text', text: 'option not allowed: ' + bad }] };
      try {
        const cp: any = await import('node:child_process');
        const result: any = await new Promise((ok, fail) => cp.execFile('git', [args.subcommand, ...(args.args || [])], { cwd: context.cwd, shell: false, env: { ...process.env, GIT_PAGER: 'cat', PAGER: 'cat', GIT_EXTERNAL_DIFF: undefined } }, (error: any, stdout: string, stderr: string) => error ? fail(Object.assign(error, { stderr })) : ok({ stdout })));
        return { content: [{ type: 'text', text: result.stdout }] };
      } catch (error: any) { return { isError: true, content: [{ type: 'text', text: error.stderr || error.message }] }; }
    }});
  }
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
