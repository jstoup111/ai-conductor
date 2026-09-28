/**
 * Static AST audit for shipped GitHub and remote-Git invocation boundaries.
 *
 * Rules (adr-2026-09-11-github-operation-ownership D1/D7):
 * - Every executable site whose program resolves to `gh` is a finding, read or
 *   write. Resolution follows child-process/execa imports (static, dynamic,
 *   `require`), promisified and re-bound aliases, in-file string constants and
 *   in-file wrapper helpers that forward an executable parameter. Shell strings
 *   handed to `exec`, `execSync`, `sh|bash -c`, or `shell: true` are findings
 *   when they invoke `gh`. Any call passing the literal `'gh'` as a program name
 *   is a finding even when its callee is not traceable in this file.
 * - Every injected runner call is a finding unless it is one of the named
 *   guarded seams. A runner is inferred from `GhRunner` types, structural
 *   `(args: string[]) => Promise<{ stdout }>` shapes, `makeProductionGh()`
 *   results through `??`/`||`/`?:`/parentheses, and the conventional runner
 *   names `gh`, `runGh`, `ghRunner` (name inference fails closed by design).
 * - Raw GitHub HTTP transports are findings at import and at each call.
 * - The one admitted `gh` process call is the transport inside
 *   `makeProductionGh` in tracker-client.ts (`productionGhTransportCall`).
 * - A process call whose program is unresolvable is a finding only when its
 *   argv carries a `gh` command family. D7 is explicit that this audit is not a
 *   general-purpose process sandbox, so generic runners of project scripts,
 *   test commands, or openers whose program is an opaque parameter stay clean.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { GITHUB_OPERATION_REGISTRY, type GithubOperationName } from './github-operations.js';

export interface GithubInvocationAuditFinding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export interface GithubInvocationAuditSite {
  readonly file: string;
  readonly line: number;
  readonly command: 'gh' | 'git';
  readonly classification: 'approved-adapter' | 'local-git' | 'remote-read' | 'remote-write' | 'github-read';
}

const PROCESS_MODULE = /^(?:node:)?child_process$/;
const EXECA_MODULE = /^execa(?:\/|$)/;
const GITHUB_HTTP_MODULE = /^(?:@octokit\/|octokit(?:$|\/)|github(?:$|\/)|node-fetch$|undici$)/;
const PROCESS_FACTORY_NAMES = new Set(['exec', 'execFile', 'spawn', 'execSync', 'execFileSync', 'spawnSync']);
const GITHUB_MUTATIONS = new Set(['create', 'edit', 'close', 'comment', 'ready', 'merge', 'reopen', 'delete', 'add', 'remove', 'set']);
const REMOTE_GIT_WRITES = new Set(['push']);
const REMOTE_GIT_READS = new Set(['fetch', 'clone', 'ls-remote']);
const HTTP_MODULE = /^(?:node:)?https?$/;
const HTTP_REQUEST_NAMES = new Set(['request', 'get']);
const SHELL_PROGRAMS = new Set(['sh', 'bash', 'zsh', 'dash']);
const SHELL_STRING_FACTORIES = new Set(['exec', 'execSync']);
/** Runner-value names that fail closed even when their type is not traceable in-file. */
const CONVENTIONAL_RUNNER_NAMES = new Set(['gh', 'runGh', 'ghRunner', 'ghRun', 'productionGh']);
/** A `gh` top-level command family: an opaque program with this argv head is treated as gh. */
const GH_COMMAND_FAMILIES = new Set(['pr', 'issue', 'api', 'repo', 'label', 'auth', 'release', 'run', 'workflow', 'search', 'gist', 'project', 'secret', 'variable', 'ruleset', 'cache', 'codespace', 'extension', 'org', 'ssh-key', 'gpg-key', 'status', 'browse', '--version', 'version']);
/** A `gh` invocation inside a shell string, at the start or after a shell operator. */
const SHELL_GH = /(?:^|[\s;&|(`{$])gh\s/;

type MutationOperation = Exclude<GithubOperationName, 'issue.read' | 'pull-request.read' | 'repository.read'>;
interface OperationCallerProof { readonly adapter: 'createGuardedGithubOperationRunner' | 'executeRemoteGit'; readonly owner: string; }

/**
 * Explicit (and exhaustively typed) inventory: a registry addition cannot pass
 * until its production caller is classified at the guarded adapter boundary.
 */
export const SHIPPED_MUTATION_OPERATION_CALLER_PROOFS = {
  'issue.comment.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.comment.update': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.edit': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.close': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.label.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.label.remove': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.dependency.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.dependency.remove': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.comment.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.comment.update': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.edit': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.ready': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.draft': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.label.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.label.remove': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.comment.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.comment.update': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.close': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.label.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.label.remove': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.dependency.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'commit.status.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'label-definition.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'label-definition.update': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'repository.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'remote-ref.push': { adapter: 'executeRemoteGit', owner: 'remote-git-operations.ts' },
  'remote-ref.delete': { adapter: 'executeRemoteGit', owner: 'remote-git-operations.ts' },
} as const satisfies Record<MutationOperation, OperationCallerProof>;

function normalizedFile(file: string): string { return file.split(sep).join('/').replace(/^.*?\/src\//, ''); }
function location(sourceFile: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const value = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: value.line + 1, column: value.character + 1 };
}
function report(sourceFile: ts.SourceFile, file: string, node: ts.Node, message: string): GithubInvocationAuditFinding {
  return { file, ...location(sourceFile, node), message };
}
function text(node: ts.Expression | undefined): string | undefined {
  return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}
function argv(node: ts.Expression | undefined): readonly string[] | undefined {
  if (!node || !ts.isArrayLiteralExpression(node)) return undefined;
  const values: string[] = [];
  for (const value of node.elements) {
    if (ts.isSpreadElement(value)) return undefined;
    const item = text(value as ts.Expression);
    if (item === undefined) return undefined;
    values.push(item);
  }
  return values;
}
function argvHead(node: ts.Expression | undefined): readonly string[] | undefined {
  if (!node || !ts.isArrayLiteralExpression(node) || node.elements.length === 0) return undefined;
  const values: string[] = [];
  for (const value of node.elements) {
    if (ts.isSpreadElement(value)) return undefined;
    const item = text(value as ts.Expression);
    if (item === undefined) break;
    values.push(item);
  }
  return values.length > 0 ? values : undefined;
}
function ghMutation(args: readonly string[]): boolean {
  if (args[0] === 'api') return args.some((arg) => /^(?:--method=?)?(?:POST|PUT|PATCH|DELETE)$/i.test(arg));
  return (args[0] === 'issue' || args[0] === 'pr' || args[0] === 'label') && GITHUB_MUTATIONS.has(args[1] ?? '');
}
function sourceFile(file: string, source: string): ts.SourceFile { return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }

function typeReferenceName(node: ts.TypeNode | undefined): string | undefined {
  return node && ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) ? node.typeName.text : undefined;
}

/**
 * Find locally injected GhRunner values before inspecting their calls.  A
 * runner is a transport capability, not an authorization capability: allowing
 * a helper to invoke it with mutable argv would bypass the typed operation
 * boundary even though no child-process import appears in that helper.
 */
interface InjectedGhRunners {
  readonly names: ReadonlySet<string>;
  readonly properties: ReadonlyMap<string, ReadonlySet<string>>;
  /** Local names bound to `makeProductionGh`: calling one yields a runner value. */
  readonly factories: ReadonlySet<string>;
}

function injectedGhRunnerNames(parsed: ts.SourceFile): InjectedGhRunners {
  const runnerTypes = new Set(['GhRunner']);
  const runners = new Set<string>();
  const factories = new Set<string>();
  const runnerProperties = new Map<string, Set<string>>();
  const typeAliases = new Map<string, ts.TypeNode>();
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          const imported = item.propertyName?.text ?? item.name.text;
          if (imported === 'GhRunner') runnerTypes.add(item.name.text);
          if (imported === 'makeProductionGh') factories.add(item.name.text);
        }
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'makeProductionGh') factories.add('makeProductionGh');
    if (ts.isTypeAliasDeclaration(node)) typeAliases.set(node.name.text, node.type);
    if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
    ts.forEachChild(node, collect);
  };
  collect(parsed);

  const isRunnerType = (type: ts.TypeNode | undefined, seen = new Set<string>()): boolean => {
    if (!type) return false;
    if (ts.isParenthesizedTypeNode(type)) return isRunnerType(type.type, seen);
    if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) return type.types.some((part) => isRunnerType(part, seen));
    const name = typeReferenceName(type);
    if (!name) return false;
    if (runnerTypes.has(name)) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return isRunnerType(typeAliases.get(name), seen);
  };
  const propertyName = (name: ts.PropertyName): string | undefined => ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
  const propertiesWithRunner = (type: ts.TypeNode | undefined, seen = new Set<string>()): Set<string> => {
    const properties = new Set<string>();
    if (!type) return properties;
    if (ts.isParenthesizedTypeNode(type)) return propertiesWithRunner(type.type, seen);
    const addProperties = (members: ts.NodeArray<ts.TypeElement | ts.ClassElement>): void => {
      for (const member of members) {
        if ((ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) && isRunnerType(member.type)) {
          const name = propertyName(member.name);
          if (name) properties.add(name);
        }
      }
    };
    if (ts.isTypeLiteralNode(type)) addProperties(type.members);
    const name = typeReferenceName(type);
    if (name && !seen.has(name)) {
      seen.add(name);
      const alias = typeAliases.get(name);
      const declaration = interfaces.get(name);
      if (alias) for (const property of propertiesWithRunner(alias, seen)) properties.add(property);
      if (declaration) addProperties(declaration.members);
    }
    return properties;
  };
  const mark = (name: ts.BindingName, type: ts.TypeNode | undefined): void => {
    if (ts.isIdentifier(name)) {
      if (isRunnerType(type) || CONVENTIONAL_RUNNER_NAMES.has(name.text)) runners.add(name.text);
      const properties = propertiesWithRunner(type);
      if (properties.size > 0) runnerProperties.set(name.text, properties);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) continue;
      const sourceName = element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : element.name.text;
      if (propertiesWithRunner(type).has(sourceName) || CONVENTIONAL_RUNNER_NAMES.has(sourceName)) runners.add(element.name.text);
    }
  };
  const propertyAlias = (initializer: ts.Expression | undefined): boolean =>
    !!initializer
    && ts.isPropertyAccessExpression(initializer)
    && ts.isIdentifier(initializer.expression)
    && runnerProperties.get(initializer.expression.text)?.has(initializer.name.text) === true;
  const destructuredAlias = (initializer: ts.Expression | undefined, property: string): boolean =>
    !!initializer && ts.isIdentifier(initializer) && runnerProperties.get(initializer.text)?.has(property) === true;
  const state: InjectedGhRunners = { names: runners, properties: runnerProperties, factories };
  const classify = (node: ts.Node): void => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
      if (ts.isIdentifier(node.name) || ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) {
        mark(node.name, node.type);
      }
      if (ts.isVariableDeclaration(node)) {
        if (ts.isIdentifier(node.name) && isRunnerExpression(node.initializer, state)) runners.add(node.name.text);
        if (ts.isIdentifier(node.name) && propertyAlias(node.initializer)) runners.add(node.name.text);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            const sourceName = element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : element.name.text;
            if (destructuredAlias(node.initializer, sourceName)) runners.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, classify);
  };
  classify(parsed);
  return state;
}

/**
 * Whether an expression evaluates to an injected runner. Every branch of a
 * `??`, `||`, or conditional counts: a fallback to `makeProductionGh()` makes
 * the whole expression a transport regardless of which side is taken.
 */
function isRunnerExpression(node: ts.Expression | undefined, runners: InjectedGhRunners): boolean {
  if (!node) return false;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isAwaitExpression(node) || ts.isSatisfiesExpression(node)) {
    return isRunnerExpression(node.expression, runners);
  }
  if (ts.isIdentifier(node)) return runners.names.has(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ThisKeyword) return runners.names.has(node.name.text);
    if (CONVENTIONAL_RUNNER_NAMES.has(node.name.text)) return true;
    return ts.isIdentifier(node.expression) && runners.properties.get(node.expression.text)?.has(node.name.text) === true;
  }
  if (ts.isCallExpression(node)) return ts.isIdentifier(node.expression) && runners.factories.has(node.expression.text);
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.QuestionQuestionToken || operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      return isRunnerExpression(node.left, runners) || isRunnerExpression(node.right, runners);
    }
    return false;
  }
  if (ts.isConditionalExpression(node)) return isRunnerExpression(node.whenTrue, runners) || isRunnerExpression(node.whenFalse, runners);
  return false;
}

function directGhInvocation(node: ts.CallExpression, runners: InjectedGhRunners): boolean {
  return isRunnerExpression(node.expression, runners);
}

function enclosingFunction(node: ts.Node): ts.FunctionDeclaration | undefined {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current)) return current;
  }
  return undefined;
}

function enclosingFunctionName(node: ts.Node): string | undefined { return enclosingFunction(node)?.name?.text; }

function isPropertyAccess(node: ts.Node | undefined, object: string, property: string): boolean {
  return !!node
    && ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === object
    && node.name.text === property;
}

function isCanonicalGuardedAdapterTransportCall(file: string, node: ts.CallExpression): boolean {
  const owner = enclosingFunction(node);
  if (normalizedFile(file) !== 'engine/tracker-client.ts'
    || owner?.name?.text !== 'createGuardedGithubOperationRunner'
    || owner.parameters.length !== 2) return false;
  const [transport, options] = owner.parameters;
  if (!ts.isIdentifier(transport.name) || transport.name.text !== 'transport'
    || typeReferenceName(transport.type) !== 'GhRunner'
    || !ts.isIdentifier(options.name) || options.name.text !== 'options'
    || !ts.isIdentifier(node.expression) || node.expression.text !== 'transport'
    || node.arguments.length !== 2) return false;
  const [command, executionOptions] = node.arguments;
  if (!ts.isCallExpression(command) || !ts.isIdentifier(command.expression)
    || command.expression.text !== 'ghArgsFor' || command.arguments.length !== 1
    || !ts.isIdentifier(command.arguments[0]) || command.arguments[0].text !== 'request'
    || !ts.isObjectLiteralExpression(executionOptions) || executionOptions.properties.length !== 2) return false;
  const [cwd, credential] = executionOptions.properties;
  return ts.isPropertyAssignment(cwd)
    && cwd.name.getText() === 'cwd'
    && isPropertyAccess(cwd.initializer, 'options', 'cwd')
    && (ts.isShorthandPropertyAssignment(credential)
      ? credential.name.text === 'credential'
      : ts.isPropertyAssignment(credential)
        && credential.name.getText() === 'credential'
        && text(credential.initializer) === 'operator');
}

/**
 * Approved calls are structural, never file-wide.  Each accepted mutation is
 * the canonical guarded adapter. Literal mutations remain findings everywhere
 * else: a composition helper cannot confer write authority merely by naming
 * its callback after a registered operation.
 */
function guardedMutationRunnerCall(file: string, node: ts.CallExpression): boolean {
  return isCanonicalGuardedAdapterTransportCall(file, node);
}

/** Every dynamic GhRunner forwarding exemption is bound to its real owner. */
const GUARDED_DYNAMIC_RUNNER_FORWARDER_OWNERS: Readonly<Record<
  'runTrackerRead' | 'runTrackerAmbientRead' | 'runTrackerGraphqlRead' | 'runTrackerIssueOperation' | 'guardedPrRunner',
  readonly string[]
>> = {
  runTrackerRead: ['engine/tracker-client.ts'],
  runTrackerAmbientRead: ['engine/tracker-client.ts'],
  runTrackerGraphqlRead: ['engine/tracker-client.ts'],
  runTrackerIssueOperation: ['engine/tracker-client.ts'],
  guardedPrRunner: ['engine/gate-writeback.ts', 'engine/pr-labels.ts'],
};

/** Dynamic runner forwarding is safe only inside an explicitly typed read or adapter seam. */
function guardedDynamicRunnerForwarding(file: string, node: ts.CallExpression): boolean {
  const owner = enclosingFunctionName(node);
  if (isCanonicalGuardedAdapterTransportCall(file, node)) return true;
  if (owner === 'runTrackerRead' || owner === 'runTrackerAmbientRead' || owner === 'runTrackerGraphqlRead' || owner === 'runTrackerIssueOperation') {
    return GUARDED_DYNAMIC_RUNNER_FORWARDER_OWNERS[owner].includes(normalizedFile(file));
  }
  if (owner !== 'guardedPrRunner') return false;
  if (!GUARDED_DYNAMIC_RUNNER_FORWARDER_OWNERS.guardedPrRunner.includes(normalizedFile(file))) return false;
  const declaration = node.parent.parent;
  return ts.isVariableDeclaration(declaration)
    && ts.isIdentifier(declaration.name)
    && declaration.name.text === 'read'
    && declaration.type !== undefined;
}

/**
 * The production `gh` transport may forward its caller-provided argv only from
 * its one real shell boundary.  This deliberately does not exempt the file:
 * a second literal `gh` write in tracker-client.ts remains a finding.
 */
function productionGhTransportCall(file: string, node: ts.CallExpression): boolean {
  return normalizedFile(file) === 'engine/tracker-client.ts'
    && enclosingFunctionName(node) === 'makeProductionGh'
    && text(node.arguments[0]) === 'gh'
    && ts.isIdentifier(node.arguments[1])
    && node.arguments[1].text === 'args';
}

function remoteGitRunnerInvocation(node: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'runRemoteGit';
}

/** The remote adapter's transport call must forward precisely its guarded argv. */
function guardedRemoteGitRunnerCall(file: string, node: ts.CallExpression): boolean {
  const args = node.arguments[0];
  return normalizedFile(file) === 'engine/remote-git-operations.ts'
    && enclosingFunctionName(node) === 'executeRemoteGit'
    && remoteGitRunnerInvocation(node)
    && ts.isArrayLiteralExpression(args)
    && args.elements.length === 1
    && ts.isSpreadElement(args.elements[0])
    && ts.isIdentifier(args.elements[0].expression)
    && args.elements[0].expression.text === 'args';
}

/**
 * `createBlockerResolver` is an import-bound read composition: its `run`
 * callback queries GitHub's dependency graph and does not own a mutation.
 * Preserve this narrowly proven dynamic argv path without exempting arbitrary
 * aliases or callbacks that could forward a write.
 */
/**
 * An identity adapter — a function whose own first parameter is the argv it
 * hands to the runner — constructs no command. It is a runner value in another
 * injectable shape, and is audited wherever it is invoked, so the forwarding
 * call inside it is not a bypass. A function that forwards any other value
 * (a later parameter, a captured variable) remains mutable forwarding.
 */
function runnerAdapterForwarding(node: ts.CallExpression): boolean {
  const argument = node.arguments[0];
  if (!argument || !ts.isIdentifier(argument)) return false;
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) {
      const first = current.parameters[0];
      return !!first && ts.isIdentifier(first.name) && first.name.text === argument.text;
    }
  }
  return false;
}

function readOnlyRunnerForwarding(node: ts.CallExpression, readOnlyFactories: ReadonlySet<string>): boolean {
  const callback = node.parent;
  if (!ts.isArrowFunction(callback) || callback.body !== node) return false;
  const property = callback.parent;
  if (!ts.isPropertyAssignment(property) || property.name.getText() !== 'run') return false;
  const options = property.parent;
  if (!ts.isObjectLiteralExpression(options)) return false;
  const factory = options.parent;
  return ts.isCallExpression(factory) && ts.isIdentifier(factory.expression) && readOnlyFactories.has(factory.expression.text);
}

/**
 * Process bindings collected for one file before any site is judged: every
 * name that reaches a child-process factory, in-file string constants that may
 * name a program, and in-file wrappers that forward an executable parameter.
 */
interface ProcessBindings {
  readonly aliases: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
  readonly constants: ReadonlyMap<string, string>;
  /** wrapper name -> index of the parameter forwarded as the program name */
  readonly wrappers: ReadonlyMap<string, number>;
  readonly httpNamespaces: ReadonlySet<string>;
  readonly httpRequests: ReadonlySet<string>;
  readonly rawGithubImports: ReadonlySet<string>;
  readonly rawGithubImportNodes: readonly ts.Node[];
  readonly readOnlyFactories: ReadonlySet<string>;
}

function processFactoryReference(node: ts.Expression | undefined, bindings: ProcessBindings): boolean {
  return !!node && (
    (ts.isIdentifier(node) && bindings.aliases.has(node.text))
    || (ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && bindings.namespaces.has(node.expression.text)
      && PROCESS_FACTORY_NAMES.has(node.name.text))
  );
}

/** The factory name a call reaches (`exec`, `spawn`, ...) when it can be told from the alias. */
function processFactoryName(node: ts.Expression, bindings: ProcessBindings): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isIdentifier(node)) return bindings.aliases.has(node.text) ? node.text : undefined;
  return undefined;
}

function isImportCall(node: ts.Expression, test: RegExp): boolean {
  return ts.isCallExpression(node)
    && node.expression.kind === ts.SyntaxKind.ImportKeyword
    && text(node.arguments[0]) !== undefined
    && test.test(text(node.arguments[0])!);
}

function isRequireCall(node: ts.Expression, test: RegExp): boolean {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'require'
    && text(node.arguments[0]) !== undefined
    && test.test(text(node.arguments[0])!);
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAwaitExpression(current) || ts.isAsExpression(current)
    || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

function bindPatternFactories(name: ts.BindingName, aliases: Set<string>): void {
  if (!ts.isObjectBindingPattern(name)) return;
  for (const element of name.elements) {
    if (!ts.isIdentifier(element.name)) continue;
    const sourceName = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text;
    if (PROCESS_FACTORY_NAMES.has(sourceName)) aliases.add(element.name.text);
  }
}

function collectProcessBindings(parsed: ts.SourceFile): ProcessBindings {
  const aliases = new Set<string>();
  const namespaces = new Set<string>();
  const constants = new Map<string, string>();
  const wrappers = new Map<string, number>();
  const httpNamespaces = new Set<string>();
  const httpRequests = new Set<string>();
  const rawGithubImports = new Set<string>();
  const rawGithubImportNodes: ts.Node[] = [];
  const readOnlyFactories = new Set<string>();
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    const module = statement.moduleSpecifier.text;
    if (PROCESS_MODULE.test(module)) {
      if (statement.importClause?.name) namespaces.add(statement.importClause.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if (PROCESS_FACTORY_NAMES.has(item.propertyName?.text ?? item.name.text)) aliases.add(item.name.text);
      }
    }
    if (EXECA_MODULE.test(module)) {
      if (statement.importClause?.name) aliases.add(statement.importClause.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if (/^(?:execa|execaSync|execaCommand|execaCommandSync|\$)$/.test(item.propertyName?.text ?? item.name.text)) aliases.add(item.name.text);
      }
    }
    if (HTTP_MODULE.test(module)) {
      if (statement.importClause?.name) httpNamespaces.add(statement.importClause.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) httpNamespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if (HTTP_REQUEST_NAMES.has(item.propertyName?.text ?? item.name.text)) httpRequests.add(item.name.text);
      }
    }
    if (GITHUB_HTTP_MODULE.test(module)) {
      if (!statement.importClause?.isTypeOnly) rawGithubImportNodes.push(statement);
      if (bindings && ts.isNamespaceImport(bindings)) rawGithubImports.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) rawGithubImports.add(item.name.text);
      if (statement.importClause?.name) rawGithubImports.add(statement.importClause.name.text);
    }
    if (module.endsWith('/blocker-resolver.js') && bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if ((item.propertyName?.text ?? item.name.text) === 'createBlockerResolver') readOnlyFactories.add(item.name.text);
      }
    }
  }
  const state: ProcessBindings = { aliases, namespaces, constants, wrappers, httpNamespaces, httpRequests, rawGithubImports, rawGithubImportNodes, readOnlyFactories };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = unwrapExpression(node.initializer);
      if (ts.isIdentifier(node.name)) {
        const literal = text(initializer);
        if (literal !== undefined) constants.set(node.name.text, literal);
        if (ts.isCallExpression(initializer)
          && (processFactoryReference(initializer.arguments[0], state) || processFactoryReference(initializer.expression, state))) {
          aliases.add(node.name.text);
        }
        if (processFactoryReference(initializer, state)) aliases.add(node.name.text);
        if (isImportCall(initializer, PROCESS_MODULE) || isRequireCall(initializer, PROCESS_MODULE)) namespaces.add(node.name.text);
        if (isImportCall(initializer, HTTP_MODULE) || isRequireCall(initializer, HTTP_MODULE)) httpNamespaces.add(node.name.text);
      } else if (isImportCall(initializer, PROCESS_MODULE) || isRequireCall(initializer, PROCESS_MODULE)) {
        bindPatternFactories(node.name, aliases);
      }
    }
    // `import('node:child_process').then(({ spawn }) => ...)`
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'then'
      && isImportCall(unwrapExpression(node.expression.expression), PROCESS_MODULE)) {
      const callback = node.arguments[0];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const first = callback.parameters[0];
        if (first) {
          if (ts.isIdentifier(first.name)) namespaces.add(first.name.text);
          else bindPatternFactories(first.name, aliases);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  // Wrapper helpers: a function whose parameter is forwarded as a program name.
  const wrapperVisit = (node: ts.Node): void => {
    const fn = ts.isFunctionDeclaration(node) ? node
      : ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer
        : undefined;
    const name = ts.isFunctionDeclaration(node) ? node.name?.text : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) ? node.name.text : undefined;
    if (fn && name && fn.body) {
      const parameters = fn.parameters.map((parameter) => (ts.isIdentifier(parameter.name) ? parameter.name.text : undefined));
      const search = (inner: ts.Node): void => {
        if (ts.isCallExpression(inner) && processFactoryReference(inner.expression, state)) {
          const program = inner.arguments[0] ? unwrapExpression(inner.arguments[0]) : undefined;
          if (program && ts.isIdentifier(program)) {
            const index = parameters.indexOf(program.text);
            if (index >= 0 && !wrappers.has(name)) wrappers.set(name, index);
          }
        }
        ts.forEachChild(inner, search);
      };
      search(fn.body);
    }
    ts.forEachChild(node, wrapperVisit);
  };
  wrapperVisit(parsed);
  return state;
}

type Program = { readonly kind: 'literal'; readonly value: string } | { readonly kind: 'path' } | { readonly kind: 'unresolvable' };

/** Resolve a program-name expression as far as this file allows. */
function resolveProgram(node: ts.Expression | undefined, bindings: ProcessBindings): Program {
  if (!node) return { kind: 'unresolvable' };
  const expression = unwrapExpression(node);
  const literal = text(expression);
  if (literal !== undefined) return { kind: 'literal', value: literal };
  if (ts.isTemplateExpression(expression)) return { kind: 'literal', value: expression.getText() };
  if (ts.isIdentifier(expression)) {
    const constant = bindings.constants.get(expression.text);
    return constant === undefined ? { kind: 'unresolvable' } : { kind: 'literal', value: constant };
  }
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression;
    const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
    if (name === 'join' || name === 'resolve') return { kind: 'path' };
  }
  return { kind: 'unresolvable' };
}

function shellOptionPresent(node: ts.Expression | undefined): boolean {
  return !!node && ts.isObjectLiteralExpression(node) && node.properties.some((property) =>
    ts.isPropertyAssignment(property) && property.name.getText() === 'shell' && property.initializer.kind === ts.SyntaxKind.TrueKeyword);
}

function shellBlockText(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  const expression = unwrapExpression(node);
  const literal = text(expression);
  if (literal !== undefined) return literal;
  return ts.isTemplateExpression(expression) ? expression.getText() : undefined;
}

function globalFetchCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) return node.expression.text === 'fetch';
  return ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && (node.expression.expression.text === 'globalThis' || node.expression.expression.text === 'global')
    && node.expression.name.text === 'fetch';
}

const GITHUB_URL = /^https?:\/\/(?:[^/]*\.)?github\.com(?:[/:]|$)/i;

function githubHttpUrl(node: ts.Expression | undefined): boolean {
  if (!node) return false;
  const expression = unwrapExpression(node);
  const url = text(expression);
  if (url !== undefined) return GITHUB_URL.test(url);
  if (ts.isTemplateExpression(expression)) return GITHUB_URL.test(expression.head.text);
  if (ts.isNewExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'URL') {
    return (expression.arguments ?? []).some((argument) => githubHttpUrl(argument));
  }
  return false;
}

function httpRequestCall(node: ts.CallExpression, bindings: ProcessBindings): boolean {
  if (ts.isIdentifier(node.expression)) return bindings.httpRequests.has(node.expression.text);
  return ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && bindings.httpNamespaces.has(node.expression.expression.text)
    && HTTP_REQUEST_NAMES.has(node.expression.name.text);
}

/** Every process-factory-shaped site, with its program and argv resolved as far as this file allows. */
interface ExecutableSite {
  readonly node: ts.CallExpression;
  readonly program: Program;
  readonly argvNode: ts.Expression | undefined;
  readonly optionsNode: ts.Expression | undefined;
  readonly factory: string | undefined;
}

function executableSite(node: ts.CallExpression, bindings: ProcessBindings): ExecutableSite | undefined {
  if (processFactoryReference(node.expression, bindings)) {
    return { node, program: resolveProgram(node.arguments[0], bindings), argvNode: node.arguments[1], optionsNode: node.arguments[2] ?? node.arguments[1], factory: processFactoryName(node.expression, bindings) };
  }
  const wrapper = ts.isIdentifier(node.expression) ? bindings.wrappers.get(node.expression.text) : undefined;
  if (wrapper !== undefined) {
    return { node, program: resolveProgram(node.arguments[wrapper], bindings), argvNode: node.arguments[wrapper + 1], optionsNode: undefined, factory: undefined };
  }
  // Callee-agnostic fail-closed rule: a literal program name of `gh` with an argv.
  if (node.arguments.length >= 2 && text(node.arguments[0]) === 'gh') {
    return { node, program: { kind: 'literal', value: 'gh' }, argvNode: node.arguments[1], optionsNode: node.arguments[2], factory: undefined };
  }
  return undefined;
}

/** Scan one executable TypeScript source file, resolving child-process aliases. */
export function auditGithubInvocationSource(file: string, source: string): GithubInvocationAuditFinding[] {
  const parsed = sourceFile(file, source);
  const findings: GithubInvocationAuditFinding[] = [];
  const bindings = collectProcessBindings(parsed);
  const injectedRunners = injectedGhRunnerNames(parsed);
  const HTTP_MESSAGE = 'unapproved raw GitHub HTTP client invocation outside guarded adapter';
  for (const statement of bindings.rawGithubImportNodes) findings.push(report(parsed, file, statement, HTTP_MESSAGE));
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && bindings.rawGithubImports.has(node.expression.text)) {
      findings.push(report(parsed, file, node, HTTP_MESSAGE));
    }
    if (ts.isCallExpression(node)) {
      const called = ts.isIdentifier(node.expression) ? node.expression.text : undefined;
      if (remoteGitRunnerInvocation(node)) {
        const remoteArgs = argv(node.arguments[0]);
        const remoteHead = argvHead(node.arguments[0]);
        if (remoteHead?.[0] === 'push' && !guardedRemoteGitRunnerCall(file, node)) {
          findings.push(report(parsed, file, node, 'direct remote Git mutation outside executeRemoteGit'));
        } else if (!remoteArgs && !remoteHead && !guardedRemoteGitRunnerCall(file, node)) {
          findings.push(report(parsed, file, node, 'unresolvable mutable remote Git command forwarding outside executeRemoteGit'));
        }
      }
      const site = executableSite(node, bindings);
      if (site) {
        findings.push(...auditExecutableSite(parsed, file, site, bindings));
      } else if (directGhInvocation(node, injectedRunners)) {
        const directArgs = argv(node.arguments[0]);
        const directHead = argvHead(node.arguments[0]);
        if (directHead && ghMutation(directHead) && !guardedMutationRunnerCall(file, node)) {
          findings.push(report(parsed, file, node, 'direct injected GitHub mutation outside guarded adapter'));
        } else if (directHead && !guardedMutationRunnerCall(file, node)) {
          findings.push(report(parsed, file, node, 'direct injected GitHub read outside guarded adapter'));
        } else if (!directArgs && !directHead
          && !readOnlyRunnerForwarding(node, bindings.readOnlyFactories)
          && !runnerAdapterForwarding(node)
          && !guardedDynamicRunnerForwarding(file, node)) {
          findings.push(report(parsed, file, node, 'unresolvable mutable GitHub command forwarding outside guarded adapter'));
        }
      }
      if (called && bindings.rawGithubImports.has(called)) findings.push(report(parsed, file, node, HTTP_MESSAGE));
      if ((globalFetchCall(node) || httpRequestCall(node, bindings)) && githubHttpUrl(node.arguments[0])) {
        findings.push(report(parsed, file, node, HTTP_MESSAGE));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return findings;
}

function auditExecutableSite(parsed: ts.SourceFile, file: string, site: ExecutableSite, bindings: ProcessBindings): GithubInvocationAuditFinding[] {
  const { node, program } = site;
  const args = argv(site.argvNode);
  const command = argvHead(site.argvNode);
  const shellMessage = 'unapproved executable GitHub or remote-Git shell block';
  if (program.kind === 'literal') {
    const value = program.value;
    if (value === 'gh') {
      if (productionGhTransportCall(file, node)) return [];
      if (!args && !command) return [report(parsed, file, node, 'unresolvable executable command construction for gh')];
      return [report(parsed, file, node, command && ghMutation(command) ? 'direct GitHub mutation outside guarded adapter' : 'direct GitHub read outside guarded adapter')];
    }
    if (value === 'git') {
      // A generic local-Git runner is not itself a remote invocation site.
      // Literal remote pushes are, and cannot be hidden behind that runner.
      return command?.[0] === 'push' ? [report(parsed, file, node, 'direct remote Git mutation outside executeRemoteGit')] : [];
    }
    if (SHELL_PROGRAMS.has(value)) {
      const flag = args?.[0] ?? command?.[0];
      const block = site.argvNode && ts.isArrayLiteralExpression(site.argvNode) && flag && /^-[a-z]*c[a-z]*$/.test(flag)
        ? shellBlockText(site.argvNode.elements[1] as ts.Expression | undefined) : undefined;
      return block !== undefined && (SHELL_GH.test(block) || /\bgit\s+push\b/.test(block)) ? [report(parsed, file, node, shellMessage)] : [];
    }
    // A shell string: `exec('gh ...')`, `execSync(\`gh ...\`)`, `spawn('gh ...', [], { shell: true })`, `execa('gh ...', { shell: true })`.
    const shellString = (site.factory !== undefined && SHELL_STRING_FACTORIES.has(site.factory))
      || shellOptionPresent(site.optionsNode) || shellOptionPresent(site.argvNode);
    if (shellString && (SHELL_GH.test(value) || /\bgit\s+push\b/.test(value))) return [report(parsed, file, node, shellMessage)];
    return [];
  }
  if (program.kind === 'path') return [];
  // Unresolvable program: fail closed only when the argv itself is gh-shaped (D7: not a process sandbox).
  return command && GH_COMMAND_FAMILIES.has(command[0]) ? [report(parsed, file, node, 'unresolvable executable command construction for gh')] : [];
}

/** Enumerate runtime only: historical docs, examples, generated output, and tests never enter. */
export function shippedRuntimeTypescriptFiles(conductorRoot: string): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.mts')) && !entry.name.endsWith('.d.ts')) files.push(path);
    }
  };
  for (const runtimeRoot of ['src', 'scripts']) {
    const directory = join(conductorRoot, runtimeRoot);
    if (existsSync(directory)) walk(directory);
  }
  return files.sort();
}

/** Run the shipped-runtime audit and report paths relative to the runtime root. */
export function auditShippedGithubInvocationBoundary(conductorRoot: string): GithubInvocationAuditFinding[] {
  const findings: GithubInvocationAuditFinding[] = [];
  for (const operation of Object.keys(GITHUB_OPERATION_REGISTRY) as GithubOperationName[]) {
    if (GITHUB_OPERATION_REGISTRY[operation].access !== 'read' && !(operation in SHIPPED_MUTATION_OPERATION_CALLER_PROOFS)) {
      findings.push({ file: 'engine/github-operations.ts', line: 1, column: 1, message: `unclassified registered mutation '${operation}'` });
    }
  }
  for (const file of shippedRuntimeTypescriptFiles(conductorRoot)) {
    const runtimeFile = relative(conductorRoot, file).split(sep).join('/');
    const auditFile = runtimeFile.startsWith('src/') ? runtimeFile.slice('src/'.length) : runtimeFile;
    const source = readFileSync(file, 'utf8');
    // Every runtime file is audited in full: there is no file-level inventory
    // or exemption, so a new executable site is classified where it appears.
    const sites = findGithubInvocationSites(auditFile, source);
    findings.push(...auditGithubInvocationSource(auditFile, source));
    for (const site of sites) {
      if (site.classification === 'remote-write') {
        findings.push({ file: site.file, line: site.line, column: 1, message: 'unclassified executable GitHub invocation site' });
      }
    }
  }
  const repositoryRoots = [join(conductorRoot, '..', '..'), conductorRoot];
  const scanned = new Set<string>();
  for (const repositoryRoot of repositoryRoots) for (const directory of [join(repositoryRoot, 'skills'), join(repositoryRoot, 'bin')]) {
    if (!existsSync(directory)) continue;
    const stack = [directory];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const file = join(current, entry.name);
        if (entry.isDirectory()) { stack.push(file); continue; }
        if (!entry.isFile() || !(entry.name === 'SKILL.md' || !entry.name.includes('.'))) continue;
        if (scanned.has(file)) continue;
        scanned.add(file);
        const source = readFileSync(file, 'utf8');
        const relativeFile = relative(repositoryRoot, file).split(sep).join('/');
        const blocks = entry.name === 'SKILL.md'
          ? [...source.matchAll(/```bash\s*\n([\s\S]*?)```/g)].map((match) => ({ offset: match.index ?? 0, text: match[1] }))
          : [{ offset: 0, text: source }];
        for (const block of blocks) {
          const raw = /\bgh\s+(?:repo\s+create|pr\s+(?:create|edit|ready|comment|close|merge)|issue\s+(?:create|edit|close|comment)|api\b)|\bgit\s+push\b|\bgit\s+push\s+.*--delete\b/.exec(block.text);
          if (!raw) continue;
          const line = source.slice(0, block.offset + raw.index).split('\n').length;
          findings.push({
            file: relativeFile,
            line,
            column: 1,
            message: 'raw GitHub or remote-Git write in executable publication block; use ai-conductor github-operation',
          });
        }
      }
    }
  }
  return findings;
}

/** Boundary-site inventory for diagnostics and fixture assertions. */
export function findGithubInvocationSites(file: string, source: string): GithubInvocationAuditSite[] {
  const parsed = sourceFile(file, source);
  const bindings = collectProcessBindings(parsed);
  const sites: GithubInvocationAuditSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const site = executableSite(node, bindings);
      if (site && site.program.kind === 'literal' && (site.program.value === 'gh' || site.program.value === 'git')) {
        const command = site.program.value;
        const args = argv(site.argvNode);
        const line = location(parsed, node).line;
        if (command === 'gh') {
          const classification = productionGhTransportCall(file, node) ? 'approved-adapter' : !!args && ghMutation(args) ? 'remote-write' : 'github-read';
          sites.push({ file, line, command, classification });
        } else {
          const head = args?.[0] ?? '';
          sites.push({ file, line, command, classification: REMOTE_GIT_WRITES.has(head) ? 'remote-write' : REMOTE_GIT_READS.has(head) ? 'remote-read' : 'local-git' });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return sites;
}
