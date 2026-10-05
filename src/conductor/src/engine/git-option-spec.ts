export type GitOptionArity = 'none' | 'required' | 'optional';

export interface GitGlobalOption {
  name?: string;
  short?: string;
  arity: Exclude<GitOptionArity, 'optional'>;
  acceptsEquals: boolean;
}

export interface GitSubcommandOption {
  /** Undefined only for a short spelling that expands to canonical long names. */
  name?: string;
  short?: string;
  arity: GitOptionArity;
  negatable: boolean;
  expandsTo?: readonly string[];
}

export type GuardedSubcommand = 'reset' | 'branch' | 'clean' | 'push' | 'checkout' | 'restore';

export interface GitOptionSpec {
  global: readonly GitGlobalOption[];
  subcommands: Readonly<Record<GuardedSubcommand, readonly GitSubcommandOption[]>>;
}

const no = (name: string, short?: string, negatable = true): GitSubcommandOption => ({ name, ...(short === undefined ? {} : { short }), arity: 'none', negatable });
const required = (name: string, short?: string, negatable = true): GitSubcommandOption => ({ name, ...(short === undefined ? {} : { short }), arity: 'required', negatable });
const optional = (name: string, short?: string, negatable = true): GitSubcommandOption => ({ name, ...(short === undefined ? {} : { short }), arity: 'optional', negatable });

/**
 * Git 2.53.0 option grammar for commands guarded by ai-conductor.
 *
 * This is deliberately data only: both guard implementations consume it to
 * generate their normalizers, while the completion-helper test detects drift.
 */
export const GIT_OPTION_SPEC: GitOptionSpec = {
  global: [
    { name: 'version', short: 'v', arity: 'none', acceptsEquals: false },
    { name: 'help', short: 'h', arity: 'none', acceptsEquals: false },
    { short: 'C', arity: 'required', acceptsEquals: false },
    { short: 'c', arity: 'required', acceptsEquals: false },
    { name: 'exec-path', arity: 'none', acceptsEquals: true },
    { name: 'html-path', arity: 'none', acceptsEquals: false },
    { name: 'man-path', arity: 'none', acceptsEquals: false },
    { name: 'info-path', arity: 'none', acceptsEquals: false },
    { name: 'paginate', short: 'p', arity: 'none', acceptsEquals: false },
    { name: 'no-pager', short: 'P', arity: 'none', acceptsEquals: false },
    { name: 'no-replace-objects', arity: 'none', acceptsEquals: false },
    { name: 'no-lazy-fetch', arity: 'none', acceptsEquals: false },
    { name: 'no-optional-locks', arity: 'none', acceptsEquals: false },
    { name: 'no-advice', arity: 'none', acceptsEquals: false },
    { name: 'bare', arity: 'none', acceptsEquals: false },
    { name: 'git-dir', arity: 'required', acceptsEquals: true },
    { name: 'work-tree', arity: 'required', acceptsEquals: true },
    { name: 'namespace', arity: 'required', acceptsEquals: true },
    { name: 'config-env', arity: 'required', acceptsEquals: true },
  ],
  subcommands: {
    reset: [
      no('quiet', 'q'), no('no-refresh', undefined, false), no('refresh', undefined, false),
      no('mixed', undefined, false), no('soft', undefined, false), no('hard', undefined, false),
      no('merge', undefined, false), no('keep', undefined, false), optional('recurse-submodules'),
      no('patch', 'p'), required('unified', 'U'), required('inter-hunk-context'), no('intent-to-add', 'N'),
      required('pathspec-from-file'), no('pathspec-file-nul'),
    ],
    branch: [
      no('verbose', 'v'), no('quiet', 'q'), optional('track', 't'), required('set-upstream-to', 'u'),
      no('unset-upstream'), optional('color'), no('remotes', 'r'), required('contains'),
      optional('abbrev'), no('all', 'a'), no('delete', 'd'),
      { short: 'D', arity: 'none', negatable: false, expandsTo: ['delete', 'force'] },
      no('move', 'm'), { short: 'M', arity: 'none', negatable: false, expandsTo: ['move', 'force'] },
      no('omit-empty'), no('copy', 'c'), { short: 'C', arity: 'none', negatable: false, expandsTo: ['copy', 'force'] },
      no('list', 'l'), no('show-current'), no('create-reflog'), no('edit-description'), no('force', 'f'),
      required('merged'), optional('column'), required('sort'), required('points-at'),
      no('ignore-case', 'i'), no('recurse-submodules'), required('format'),
    ],
    clean: [
      no('quiet', 'q'), no('dry-run', 'n'), no('interactive', 'i'), required('exclude', 'e'),
      no('force', 'f'), { short: 'd', arity: 'none', negatable: false }, { short: 'x', arity: 'none', negatable: false },
      { short: 'X', arity: 'none', negatable: false },
    ],
    push: [
      no('verbose', 'v'), no('quiet', 'q'), required('repo'), no('all'), no('branches', undefined, false),
      no('mirror'), no('delete', 'd'), no('tags'), no('dry-run', 'n'), no('porcelain'), no('force', 'f'),
      optional('force-with-lease'), no('force-if-includes'), optional('recurse-submodules'), no('thin'),
      required('receive-pack'), required('exec'), no('set-upstream', 'u'), no('progress'), no('prune'),
      no('verify'), no('follow-tags'), optional('signed'), no('atomic'), required('push-option', 'o'),
      no('ipv4', '4'), no('ipv6', '6'),
    ],
    checkout: [
      required('branch', 'b'), required('orphan'), no('guess'), no('overlay'), no('quiet', 'q'), optional('recurse-submodules'),
      no('progress'), no('merge', 'm'), required('conflict'), no('detach', 'd'), optional('track', 't'), no('force', 'f'),
      no('overwrite-ignore'), no('ignore-other-worktrees'), no('ours', '2'), no('theirs', '3'), no('patch', 'p'),
      required('unified', 'U'), required('inter-hunk-context'), no('ignore-skip-worktree-bits'), required('pathspec-from-file'),
      no('pathspec-file-nul'), { short: 'B', arity: 'required', negatable: false }, { short: 'l', arity: 'none', negatable: false },
    ],
    restore: [
      required('source', 's'), no('staged', 'S'), no('worktree', 'W'), no('ignore-unmerged'), no('overlay'), no('quiet', 'q'),
      optional('recurse-submodules'), no('progress'), no('merge', 'm'), required('conflict'), no('ours', '2'), no('theirs', '3'),
      no('patch', 'p'), required('unified', 'U'), required('inter-hunk-context'), no('ignore-skip-worktree-bits'),
      required('pathspec-from-file'), no('pathspec-file-nul'),
    ],
  },
};
