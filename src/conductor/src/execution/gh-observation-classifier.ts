/**
 * Bounded pre-execution observation for the managed `gh` wrapper.
 *
 * This is deliberately an argv-only classifier. It does not authorize calls,
 * inspect stdin, open `--input` files, or retain values supplied to flags.
 */
export type GhObservationClassification =
  | { readonly kind: 'quiet' }
  | { readonly kind: 'mutation' }
  | { readonly kind: 'possible-bypass' };

const QUIET: GhObservationClassification = { kind: 'quiet' };
const MUTATION: GhObservationClassification = { kind: 'mutation' };
const POSSIBLE_BYPASS: GhObservationClassification = { kind: 'possible-bypass' };

const MUTATING_ACTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  pr: new Set(['create', 'edit', 'close', 'reopen', 'merge', 'ready', 'review', 'comment', 'lock', 'unlock']),
  issue: new Set(['create', 'edit', 'close', 'reopen', 'delete', 'comment', 'transfer', 'pin', 'unpin', 'lock', 'unlock']),
  repo: new Set(['create', 'delete', 'edit', 'rename', 'sync', 'fork', 'archive', 'unarchive']),
  release: new Set(['create', 'edit', 'delete', 'upload']),
  label: new Set(['create', 'edit', 'delete', 'clone']),
  workflow: new Set(['enable', 'disable', 'run']),
  variable: new Set(['set', 'delete']),
  secret: new Set(['set', 'delete']),
  project: new Set(['create', 'edit', 'delete', 'link', 'unlink', 'copy', 'close', 'reopen']),
  ruleset: new Set(['create', 'edit', 'delete']),
  'gpg-key': new Set(['add', 'delete']),
  'ssh-key': new Set(['add', 'delete']),
  cache: new Set(['delete']),
};

const QUIET_ACTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  pr: new Set(['view', 'list', 'status', 'checks', 'diff', 'checkout']),
  issue: new Set(['view', 'list', 'status', 'develop']),
  repo: new Set(['view', 'list', 'clone']),
  release: new Set(['view', 'list', 'download']),
  workflow: new Set(['view', 'list']),
  run: new Set(['view', 'list', 'watch', 'download']),
  variable: new Set(['list', 'get']),
  secret: new Set(['list']),
  project: new Set(['list', 'view', 'item-list']),
  label: new Set(['list']),
  cache: new Set(['list']),
  ruleset: new Set(['list', 'view']),
  search: new Set(['code', 'commits', 'issues', 'prs', 'repos']),
  gist: new Set(['list', 'view', 'clone']),
};

const GLOBAL_FLAGS_WITH_VALUE = new Set(['--repo', '-R', '--hostname']);
const API_FIELD_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '--form']);
const API_INPUT_FLAGS = new Set(['--input']);
const API_METHOD_FLAGS = new Set(['--method', '-X']);

/**
 * Classify gh arguments without looking beyond their bounded command shape.
 * Unknown, extension, alias, GraphQL, and payload-file forms are deliberately
 * not upgraded into read-only verdicts.
 */
export function classifyGhObservation(argv: readonly string[]): GhObservationClassification {
  const command = commandArguments(argv);
  const family = command[0];
  if (family === undefined || family === 'help' || family === 'completion' || family === '--version') return QUIET;
  if (family === 'api') return classifyApi(command.slice(1));
  if (family === 'alias' || family === 'extension') return POSSIBLE_BYPASS;

  const action = command.slice(1).find((token) => !token.startsWith('-'));
  if (action !== undefined && MUTATING_ACTIONS[family]?.has(action)) return MUTATION;
  if (action !== undefined && QUIET_ACTIONS[family]?.has(action)) return QUIET;
  return POSSIBLE_BYPASS;
}

function commandArguments(argv: readonly string[]): readonly string[] {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (GLOBAL_FLAGS_WITH_VALUE.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('--repo=') || token.startsWith('--hostname=')) continue;
    if (token.startsWith('-')) continue;
    return argv.slice(index);
  }
  return [];
}

function classifyApi(tokens: readonly string[]): GhObservationClassification {
  if (tokens.includes('graphql')) return POSSIBLE_BYPASS;

  let method: string | undefined;
  let hasField = false;
  let hasOpaqueInput = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (API_METHOD_FLAGS.has(token)) {
      const value = tokens[index + 1];
      if (value === undefined || value.startsWith('-')) return POSSIBLE_BYPASS;
      method = value.toUpperCase();
      index += 1;
      continue;
    }
    if (token.startsWith('--method=')) {
      method = token.slice('--method='.length).toUpperCase();
      continue;
    }
    if (token.startsWith('-X') && token.length > 2) {
      method = token.slice(2).toUpperCase();
      continue;
    }
    if (API_FIELD_FLAGS.has(token) || [...API_FIELD_FLAGS].some((flag) => token.startsWith(`${flag}=`))
      || /^-[fF].+/.test(token)) {
      hasField = true;
      if (API_FIELD_FLAGS.has(token)) index += 1;
      continue;
    }
    if (API_INPUT_FLAGS.has(token) || token.startsWith('--input=')) {
      hasOpaqueInput = true;
      if (API_INPUT_FLAGS.has(token)) index += 1;
    }
  }

  if (method === 'GET' || method === 'HEAD') return QUIET;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') return MUTATION;
  if (method !== undefined) return POSSIBLE_BYPASS;
  if (hasField) return MUTATION;
  if (hasOpaqueInput) return POSSIBLE_BYPASS;
  return QUIET;
}
