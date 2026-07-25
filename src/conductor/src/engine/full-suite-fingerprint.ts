import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  type Hash,
  type Hmac,
} from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import { execa } from 'execa';
import type { TestSuiteConfig } from '../types/config.js';

export type FullSuiteFingerprintIndeterminateCode =
  | 'git_enumeration_failed'
  | 'invalid_input'
  | 'missing_input'
  | 'input_enumeration_failed'
  | 'input_read_failed';

export interface FullSuiteFingerprintIndeterminate {
  code: FullSuiteFingerprintIndeterminateCode;
  message: string;
  path?: string;
}

export interface FullSuiteFingerprint {
  digest: string;
  headSha: string;
  categoryFingerprints: FullSuiteCategoryFingerprints;
}

export const FULL_SUITE_FINGERPRINT_CATEGORIES = [
  'additional_inputs',
  'dependencies',
  'environment',
  'migrations',
  'project_config',
  'source',
  'test_infrastructure',
  'tests',
] as const;

export type FullSuitePersistedFingerprintCategory =
  (typeof FULL_SUITE_FINGERPRINT_CATEGORIES)[number];

export type FullSuiteFingerprintCategory = FullSuitePersistedFingerprintCategory;

export type FullSuiteCategoryFingerprints = Record<
  FullSuitePersistedFingerprintCategory,
  string
>;

export type FullSuiteFingerprintResult =
  | { ok: true; fingerprint: FullSuiteFingerprint }
  | { ok: false; reason: FullSuiteFingerprintIndeterminate };

export type FullSuiteFileHasher = (absolutePath: string) => Promise<string>;

export interface FullSuiteFingerprintOptions {
  projectRoot: string;
  testSuite: TestSuiteConfig;
  environmentValues?: NodeJS.ProcessEnv;
  /** Test seam for deterministic unreadable/hash-failure coverage. */
  fileHasher?: FullSuiteFileHasher;
}

class FingerprintFailure extends Error {
  constructor(readonly reason: FullSuiteFingerprintIndeterminate) {
    super(reason.message);
  }
}

function fail(
  code: FullSuiteFingerprintIndeterminateCode,
  message: string,
  path?: string,
): never {
  throw new FingerprintFailure({ code, message, ...(path === undefined ? {} : { path }) });
}

function nulSeparatedPaths(stdout: string): string[] {
  return stdout.split('\0').filter((path) => path.length > 0);
}

async function gitOutput(projectRoot: string, args: string[]): Promise<string> {
  try {
    const result = await execa('git', args, { cwd: projectRoot });
    return result.stdout;
  } catch {
    return fail('git_enumeration_failed', 'Unable to enumerate the Git working tree');
  }
}

function comparePaths(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort(comparePaths);
}

function isFullSuiteProjectInput(path: string): boolean {
  const normalized = path.trim();
  if (!normalized) return false;
  if (normalized === '.pipeline' || normalized.startsWith('.pipeline/')) return false;
  if (normalized === 'CHANGELOG.md') return false;
  if (normalized.startsWith('.docs/') || normalized.startsWith('docs/')) return false;
  if (/(^|\/)README(\.[A-Za-z0-9]+)?$/i.test(normalized)) return false;
  if (
    /(^|\/)(AUTHORS|CODE_OF_CONDUCT|CONTRIBUTING|LICENSE|NOTICE|SECURITY|SUPPORT)(\.[A-Za-z0-9]+)?$/i.test(
      normalized,
    )
  ) {
    return false;
  }
  if (/\.(md|mdx|rst)$/i.test(normalized)) return false;
  return true;
}

const ENVIRONMENT_KEY_PATH = '.pipeline/test-suite-environment.key';
const ENVIRONMENT_KEY_PATTERN = /^[0-9a-f]{64}\n$/;

async function readEnvironmentKey(projectRoot: string): Promise<Buffer> {
  const keyPath = join(projectRoot, ENVIRONMENT_KEY_PATH);
  let stats;
  try {
    stats = await lstat(keyPath);
  } catch {
    return fail('input_read_failed', 'Unable to inspect full-suite environment key');
  }
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    (process.platform !== 'win32' && (stats.mode & 0o077) !== 0)
  ) {
    return fail('input_read_failed', 'Full-suite environment key is not private');
  }
  let serialized: string;
  try {
    serialized = await readFile(keyPath, 'utf8');
  } catch {
    return fail('input_read_failed', 'Unable to read full-suite environment key');
  }
  if (!ENVIRONMENT_KEY_PATTERN.test(serialized)) {
    return fail('input_read_failed', 'Full-suite environment key is invalid');
  }
  return Buffer.from(serialized.trim(), 'hex');
}

async function environmentKey(projectRoot: string): Promise<Buffer> {
  const directory = join(projectRoot, '.pipeline');
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryStats = await lstat(directory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      return fail('input_read_failed', 'Full-suite state directory is invalid');
    }
  } catch (error) {
    if (error instanceof FingerprintFailure) throw error;
    return fail('input_read_failed', 'Unable to prepare full-suite environment key');
  }

  const keyPath = join(projectRoot, ENVIRONMENT_KEY_PATH);
  const temporary = join(
    directory,
    `.test-suite-environment.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, `${randomBytes(32).toString('hex')}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    try {
      await link(temporary, keyPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } catch {
    return fail('input_read_failed', 'Unable to provision full-suite environment key');
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return readEnvironmentKey(projectRoot);
}

async function environmentFingerprint(
  projectRoot: string,
  names: readonly string[],
  environmentValues: NodeJS.ProcessEnv,
): Promise<string> {
  const normalizedNames = sortedUnique([...names]);
  if (normalizedNames.length === 0) {
    const empty = createHash('sha256');
    updateField(empty, 'schema', 'full-suite-environment-v1');
    updateField(empty, 'category', 'environment');
    return empty.digest('hex');
  }
  const keyed = createHmac('sha256', await environmentKey(projectRoot));
  updateField(keyed, 'schema', 'full-suite-environment-v1');
  updateField(keyed, 'category', 'environment');
  for (const name of normalizedNames) {
    updateField(keyed, 'environment_name', name);
    const value = Object.prototype.hasOwnProperty.call(environmentValues, name)
      ? environmentValues[name]
      : undefined;
    updateField(keyed, 'environment_state', value === undefined ? 'unset' : 'set');
    if (value !== undefined) updateField(keyed, 'environment_value', value);
  }
  return keyed.digest('hex');
}

function updateField(hash: Hash | Hmac, name: string, value: string | Buffer): void {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value;
  hash.update(name);
  hash.update('\0');
  hash.update(String(bytes.length));
  hash.update('\0');
  hash.update(bytes);
  hash.update('\0');
}

function updateFields(
  hashes: readonly (Hash | Hmac)[],
  name: string,
  value: string | Buffer,
): void {
  for (const hash of hashes) updateField(hash, name, value);
}

function fingerprintCategory(
  path: string,
  explicitlyDeclared: boolean,
): FullSuitePersistedFingerprintCategory {
  if (explicitlyDeclared) return 'additional_inputs';
  const normalized = path.toLowerCase();
  const base = posix.basename(normalized);
  if (normalized.startsWith('.ai-conductor/')) return 'project_config';
  if (
    /(^|\/)(db\/migrate|migrations?)(\/|$)/.test(normalized) ||
    /(^|\/)schema\.(rb|sql)$/.test(normalized)
  ) {
    return 'migrations';
  }
  if (
    /^(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json)$/.test(base) ||
    /^(requirements.*\.txt|pyproject\.toml|poetry\.lock|pipfile(\.lock)?)$/.test(base) ||
    /^(gemfile(\.lock)?|cargo\.(toml|lock)|go\.(mod|sum))$/.test(base) ||
    /^(composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?|gradle\.properties)$/.test(base)
  ) {
    return 'dependencies';
  }
  if (
    /^(vitest|jest|playwright|cypress)\.config\.[^.]+$/.test(base) ||
    /^(pytest\.ini|tox\.ini|conftest\.py)$/.test(base) ||
    /(^|\/)(test|tests|spec|__tests__)\/(setup|support|helpers?|fixtures?)(\/|\.|$)/.test(
      normalized,
    )
  ) {
    return 'test_infrastructure';
  }
  if (
    /(^|\/)(test|tests|spec|__tests__)(\/|$)/.test(normalized) ||
    /\.(test|spec)\.[^/]+$/.test(base)
  ) {
    return 'tests';
  }
  return 'source';
}

async function streamedFileDigest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

function normalizeRelativeInput(input: string): string {
  if (
    input.length === 0 ||
    input.includes('\0') ||
    isAbsolute(input) ||
    /^[A-Za-z]:[\\/]/.test(input) ||
    input.startsWith('\\\\')
  ) {
    return fail('invalid_input', 'Declared input must be a project-relative path or glob', input);
  }

  const slashPath = input.replaceAll('\\', '/');
  if (slashPath.split('/').includes('..')) {
    return fail('invalid_input', 'Declared input must not escape the project root', input);
  }
  if (/[[\]{}]/.test(slashPath)) {
    return fail('invalid_input', 'Declared input uses unsupported glob syntax', input);
  }

  const normalized = posix.normalize(slashPath);
  if (normalized === '..' || normalized.startsWith('../')) {
    return fail('invalid_input', 'Declared input must not escape the project root', input);
  }
  return normalized.replace(/^\.\//, '');
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[\\^$.*+?()[\]|]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

function hasGlob(path: string): boolean {
  return path.includes('*') || path.includes('?');
}

function staticGlobRoot(pattern: string): string {
  const wildcardIndex = pattern.search(/[*?]/);
  const prefix = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
  const slashIndex = prefix.lastIndexOf('/');
  return slashIndex === -1 ? '.' : prefix.slice(0, slashIndex) || '.';
}

async function walkDeclaredPaths(projectRoot: string, start: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(relativeDirectory: string): Promise<void> {
    const entries = await readdir(join(projectRoot, relativeDirectory), { withFileTypes: true });
    entries.sort((left, right) => comparePaths(left.name, right.name));
    for (const entry of entries) {
      const path = relativeDirectory === '.' ? entry.name : `${relativeDirectory}/${entry.name}`;
      if (path === '.git' || path.startsWith('.git/')) continue;
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        results.push(path);
      }
    }
  }

  await visit(start);
  return results;
}

async function rejectSymlinkTraversal(
  projectRoot: string,
  path: string,
  declaration: string,
  includeLeaf: boolean,
): Promise<void> {
  const segments = path.split('/').filter((segment) => segment !== '.');
  const limit = includeLeaf ? segments.length : Math.max(segments.length - 1, 0);
  let current = projectRoot;
  for (let index = 0; index < limit; index += 1) {
    current = join(current, segments[index]);
    if ((await lstat(current)).isSymbolicLink()) {
      return fail(
        'invalid_input',
        'Declared input must not traverse a symbolic link outside the project',
        declaration,
      );
    }
  }
}

async function expandDeclaredInput(projectRoot: string, declaration: string): Promise<string[]> {
  const normalized = normalizeRelativeInput(declaration);

  try {
    if (!hasGlob(normalized)) {
      await rejectSymlinkTraversal(projectRoot, normalized, declaration, false);
      const stats = await lstat(resolve(projectRoot, normalized));
      if (stats.isSymbolicLink()) {
        return fail(
          'invalid_input',
          'Declared input must not be a symbolic link',
          declaration,
        );
      }
      if (!stats.isDirectory()) return [normalized];
      return [normalized, ...(await walkDeclaredPaths(projectRoot, normalized))];
    }

    const root = staticGlobRoot(normalized);
    await rejectSymlinkTraversal(projectRoot, root, declaration, true);
    const rootStats = await lstat(resolve(projectRoot, root));
    if (rootStats.isSymbolicLink()) {
      return fail(
        'invalid_input',
        'Declared input glob root must not be a symbolic link',
        declaration,
      );
    }
    if (!rootStats.isDirectory()) {
      return fail('missing_input', 'Declared input did not match any paths', declaration);
    }
    const matcher = globToRegExp(normalized);
    const matches = (await walkDeclaredPaths(projectRoot, root)).filter((path) =>
      matcher.test(path),
    );
    if (matches.length === 0) {
      return fail('missing_input', 'Declared input did not match any paths', declaration);
    }
    return matches;
  } catch (error) {
    if (error instanceof FingerprintFailure) throw error;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return fail('missing_input', 'Declared input did not match any paths', declaration);
    }
    return fail('input_enumeration_failed', 'Unable to enumerate declared input', declaration);
  }
}

async function normalizedWorkingDirectory(
  projectRoot: string,
  workingDirectory?: string,
): Promise<string> {
  const root = resolve(projectRoot);
  const resolvedDirectory = resolve(root, workingDirectory ?? '.');
  const lexicalRelativeDirectory = relative(root, resolvedDirectory);
  if (
    lexicalRelativeDirectory === '..' ||
    lexicalRelativeDirectory.startsWith(`..${sep}`) ||
    isAbsolute(lexicalRelativeDirectory)
  ) {
    return fail(
      'invalid_input',
      'Suite working directory must remain within the project root',
      workingDirectory,
    );
  }

  let realRoot: string;
  let realDirectory: string;
  try {
    [realRoot, realDirectory] = await Promise.all([
      realpath(root),
      realpath(resolvedDirectory),
    ]);
  } catch {
    return fail(
      'input_enumeration_failed',
      'Unable to resolve suite working directory',
      workingDirectory ?? '.',
    );
  }

  const relativeDirectory = relative(realRoot, realDirectory);
  if (
    relativeDirectory === '..' ||
    relativeDirectory.startsWith(`..${sep}`) ||
    isAbsolute(relativeDirectory)
  ) {
    return fail(
      'invalid_input',
      'Suite working directory must resolve within the project root',
      workingDirectory ?? '.',
    );
  }
  if (!(await lstat(realDirectory)).isDirectory()) {
    return fail(
      'invalid_input',
      'Suite working directory must resolve to a directory',
      workingDirectory ?? '.',
    );
  }
  return relativeDirectory === '' ? '.' : relativeDirectory.split(sep).join('/');
}

function normalizeSuiteConfig(
  testSuite: TestSuiteConfig,
  normalizedInputs: string[],
  workingDirectory: string,
): string {
  return JSON.stringify({
    command: testSuite.command,
    working_directory: workingDirectory,
    timeout_seconds: testSuite.timeout_seconds ?? null,
    inputs: sortedUnique(normalizedInputs),
    environment: sortedUnique(testSuite.environment ?? []),
  });
}

async function updatePathIdentity(
  hashes: readonly Hash[],
  projectRoot: string,
  relativePath: string,
  required: boolean,
  fileHasher: FullSuiteFileHasher,
): Promise<void> {
  updateFields(hashes, 'path', relativePath);
  const absolutePath = join(projectRoot, relativePath);

  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !required) {
      updateFields(hashes, 'state', 'deleted');
      return;
    }
    return fail('input_read_failed', 'Unable to inspect verification input', relativePath);
  }

  updateFields(hashes, 'state', 'present');
  if (stats.isDirectory()) {
    updateFields(hashes, 'mode', '040000');
    return;
  }
  if (stats.isSymbolicLink()) {
    if (required) {
      return fail(
        'invalid_input',
        'Declared input must not resolve to a symbolic link',
        relativePath,
      );
    }
    updateFields(hashes, 'mode', '120000');
    try {
      updateFields(hashes, 'content', await readlink(absolutePath));
      return;
    } catch {
      return fail('input_read_failed', 'Unable to read verification input', relativePath);
    }
  }
  if (!stats.isFile()) {
    return fail('input_read_failed', 'Verification input is not a regular file', relativePath);
  }

  updateFields(hashes, 'mode', stats.mode & 0o111 ? '100755' : '100644');
  try {
    updateFields(hashes, 'content', await fileHasher(absolutePath));
  } catch {
    return fail('input_read_failed', 'Unable to hash verification input', relativePath);
  }
}

async function calculateFingerprint(
  options: FullSuiteFingerprintOptions,
): Promise<FullSuiteFingerprint> {
  const {
    projectRoot,
    testSuite,
    environmentValues = process.env,
    fileHasher = streamedFileDigest,
  } = options;
  const normalizedInputs = (testSuite.inputs ?? []).map(normalizeRelativeInput);
  const workingDirectory = await normalizedWorkingDirectory(
    projectRoot,
    testSuite.working_directory,
  );

  const [headSha, trackedOutput, untrackedOutput, expandedInputs, environmentDigest] =
    await Promise.all([
      gitOutput(projectRoot, ['rev-parse', 'HEAD']),
      gitOutput(projectRoot, ['ls-files', '-z']),
      gitOutput(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
      Promise.all(normalizedInputs.map((input) => expandDeclaredInput(projectRoot, input))),
      environmentFingerprint(projectRoot, testSuite.environment ?? [], environmentValues),
    ]);

  const broadPaths = [
    ...nulSeparatedPaths(trackedOutput),
    ...nulSeparatedPaths(untrackedOutput),
  ].filter(isFullSuiteProjectInput);
  const requiredPaths = new Set(expandedInputs.flat());
  const paths = sortedUnique([...broadPaths, ...requiredPaths]);

  const hash = createHash('sha256');
  const categoryHashes = Object.fromEntries(
    FULL_SUITE_FINGERPRINT_CATEGORIES.map((category) => {
      const categoryHash = createHash('sha256');
      updateField(categoryHash, 'schema', 'full-suite-category-v1');
      updateField(categoryHash, 'category', category);
      return [category, categoryHash];
    }),
  ) as Record<FullSuitePersistedFingerprintCategory, Hash>;
  updateField(hash, 'schema', 'full-suite-working-tree-v3');
  updateFields(
    [hash, categoryHashes.project_config],
    'test_suite',
    normalizeSuiteConfig(testSuite, normalizedInputs, workingDirectory),
  );

  updateField(hash, 'environment_commitment', environmentDigest);

  for (const path of paths) {
    const required = requiredPaths.has(path);
    const category = fingerprintCategory(path, required);
    await updatePathIdentity(
      [hash, categoryHashes[category]],
      projectRoot,
      path,
      required,
      fileHasher,
    );
  }

  const categoryFingerprints = Object.fromEntries(
    FULL_SUITE_FINGERPRINT_CATEGORIES.map((category) => [
      category,
      category === 'environment'
        ? environmentDigest
        : categoryHashes[category].digest('hex'),
    ]),
  ) as FullSuiteCategoryFingerprints;

  return {
    digest: hash.digest('hex'),
    headSha: headSha.trim(),
    categoryFingerprints,
  };
}

export async function fingerprintFullSuiteInputs(
  options: FullSuiteFingerprintOptions,
): Promise<FullSuiteFingerprintResult> {
  try {
    return { ok: true, fingerprint: await calculateFingerprint(options) };
  } catch (error) {
    if (error instanceof FingerprintFailure) {
      return { ok: false, reason: error.reason };
    }
    return {
      ok: false,
      reason: {
        code: 'input_enumeration_failed',
        message: 'Unable to enumerate or hash verification inputs',
      },
    };
  }
}
