import ts from 'typescript';

/** Immutable source input; analysis never reads the filesystem or executes it. */
export interface TestDeclarationSource {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

export interface TestDeclarationSpan {
  readonly start: number;
  readonly end: number;
}

export type TestDeclarationKind = 'suite' | 'test' | 'group';

export interface SupportedTestDeclaration {
  readonly kind: TestDeclarationKind;
  readonly titleChain: readonly string[];
  readonly modifierChain: readonly string[];
  /** Zero-based occurrence amongst declarations with this title chain in this source. */
  readonly occurrence: number;
  readonly span: TestDeclarationSpan;
  readonly argumentsSpan: TestDeclarationSpan;
  readonly bodySpan?: TestDeclarationSpan;
  /** Present only on comparison output. */
  readonly change?: 'added' | 'modified';
}

export type TestDeclarationUncertaintyReason =
  | 'syntax-diagnostic'
  | 'unsupported-source-language'
  | 'unsupported-declaration-wrapper'
  | 'unsupported-declaration-modifier'
  | 'nonliteral-declaration-title'
  | 'uncertain-correspondence';

export interface TestDeclarationDiagnostic {
  readonly reason: TestDeclarationUncertaintyReason;
  readonly span: TestDeclarationSpan;
  readonly message: string;
}

export interface TestDeclarationAnalysis {
  readonly kind: 'supported' | 'uncertain';
  readonly declarations: readonly SupportedTestDeclaration[];
  readonly suites: readonly SupportedTestDeclaration[];
  readonly diagnostics: readonly TestDeclarationDiagnostic[];
}

export interface TestDeclarationComparison {
  readonly kind: 'compared' | 'uncertain';
  /** HEAD declarations that are executable quality targets. */
  readonly changed: readonly SupportedTestDeclaration[];
  /**
   * Base-only declarations retained as non-executable source evidence.  They
   * cannot name a HEAD region because their source no longer exists there.
   */
  readonly deleted: readonly SupportedTestDeclaration[];
  readonly uncertain: readonly TestDeclarationDiagnostic[];
}

type DeclarationRole = 'suite' | 'test';

interface ParsedDeclaration extends SupportedTestDeclaration {
  readonly role: DeclarationRole;
  readonly fingerprint: string;
  readonly correspondenceKey: string;
}

interface DeclarationIdentity {
  readonly role: DeclarationRole;
}

interface CalleeIdentity extends DeclarationIdentity {
  readonly modifiers: readonly string[];
}

class Scope {
  readonly bindings = new Map<string, DeclarationIdentity | undefined>();

  constructor(readonly parent?: Scope) {}

  resolve(name: string): DeclarationIdentity | undefined {
    if (this.bindings.has(name)) return this.bindings.get(name);
    if (this.parent) return this.parent.resolve(name);
    return LITERAL_DECLARATIONS.get(name);
  }
}

const LITERAL_DECLARATIONS = new Map<string, DeclarationIdentity>([
  ['describe', { role: 'suite' }],
  ['context', { role: 'suite' }],
  ['suite', { role: 'suite' }],
  ['it', { role: 'test' }],
  ['test', { role: 'test' }],
  ['specify', { role: 'test' }],
]);

const SUPPORTED_MODIFIERS = new Set([
  'skip', 'only', 'todo', 'fails', 'concurrent', 'sequential', 'shuffle', 'each',
  'skipIf', 'runIf', 'skipWhen', 'runWhen',
]);

const SCRIPT_KINDS = new Map<string, ts.ScriptKind>([
  ['.ts', ts.ScriptKind.TS], ['.tsx', ts.ScriptKind.TSX], ['.mts', ts.ScriptKind.TS], ['.cts', ts.ScriptKind.TS],
  ['.js', ts.ScriptKind.JS], ['.jsx', ts.ScriptKind.JSX], ['.mjs', ts.ScriptKind.JS], ['.cjs', ts.ScriptKind.JS],
]);

function sourceLanguage(fileName: string): ts.ScriptKind | undefined {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return SCRIPT_KINDS.get(extension);
}

function span(start: number, end: number): TestDeclarationSpan {
  return Object.freeze({ start, end });
}

function declarationTitle(node: ts.Expression | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

function callbackBody(call: ts.CallExpression): ts.FunctionLikeDeclarationBase | undefined {
  const callback = call.arguments.at(-1);
  return callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) ? callback : undefined;
}

function ownerForFingerprint(node: ts.CallExpression): ts.Node {
  return ts.isExpressionStatement(node.parent) || ts.isVariableDeclaration(node.parent) ? node.parent : node;
}

/** A token stream keeps comments/literals meaningful while dropping formatting trivia. */
function canonicalSyntax(source: ts.SourceFile, start: number, end: number, scriptKind: ts.ScriptKind): string {
  const languageVariant = scriptKind === ts.ScriptKind.JSX || scriptKind === ts.ScriptKind.TSX
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, languageVariant, source.text);
  scanner.setTextPos(start);
  const tokens: string[] = [];
  for (;;) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken || scanner.getTokenPos() >= end) break;
    if (kind !== ts.SyntaxKind.WhitespaceTrivia && kind !== ts.SyntaxKind.NewLineTrivia && kind !== ts.SyntaxKind.SemicolonToken) {
      tokens.push(`${kind}:${scanner.getTokenText()}`);
    }
  }
  return tokens.join('|');
}

function isVitestImport(node: ts.ImportDeclaration): boolean {
  return ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'vitest';
}

function declareImports(node: ts.ImportDeclaration, scope: Scope): void {
  if (!isVitestImport(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) return;
  for (const element of node.importClause.namedBindings.elements) {
    const imported = element.propertyName?.text ?? element.name.text;
    const identity = LITERAL_DECLARATIONS.get(imported);
    scope.bindings.set(element.name.text, identity);
  }
}

function resolveCallee(node: ts.Expression, scope: Scope): CalleeIdentity | undefined {
  if (ts.isIdentifier(node)) {
    const identity = scope.resolve(node.text);
    return identity && { ...identity, modifiers: [] };
  }
  if (ts.isPropertyAccessExpression(node)) {
    const base = resolveCallee(node.expression, scope);
    if (!base) return undefined;
    if (!SUPPORTED_MODIFIERS.has(node.name.text)) return undefined;
    return { ...base, modifiers: [...base.modifiers, node.name.text] };
  }
  if (ts.isCallExpression(node)) {
    const base = resolveCallee(node.expression, scope);
    return base;
  }
  return undefined;
}

function expressionMentionsDeclaration(node: ts.Node, scope: Scope): boolean {
  let mentioned = false;
  const inspect = (child: ts.Node): void => {
    if (ts.isIdentifier(child) && scope.resolve(child.text)) mentioned = true;
    if (!mentioned) ts.forEachChild(child, inspect);
  };
  inspect(node);
  return mentioned;
}

function declarationFromCall(
  call: ts.CallExpression,
  source: ts.SourceFile,
  scriptKind: ts.ScriptKind,
  titles: readonly string[],
  scope: Scope,
): ParsedDeclaration | undefined {
  const callee = resolveCallee(call.expression, scope);
  const title = declarationTitle(call.arguments[0]);
  if (!callee || title === undefined) return undefined;
  const callback = callbackBody(call);
  const kind: TestDeclarationKind = callee.modifiers.includes('each') ? 'group' : callee.role;
  const declarationSpan = span(call.getStart(source), call.getEnd());
  const firstArgument = call.arguments[0]!;
  const lastArgument = call.arguments.at(-1)!;
  const fullTitleChain = Object.freeze([...titles, title]);
  const owner = ownerForFingerprint(call);
  const modifierChain = Object.freeze([...callee.modifiers]);
  return {
    kind,
    role: callee.role,
    titleChain: fullTitleChain,
    modifierChain,
    occurrence: 0,
    span: declarationSpan,
    argumentsSpan: span(firstArgument.getStart(source), lastArgument.getEnd()),
    bodySpan: callback?.body ? span(callback.body.getStart(source), callback.body.getEnd()) : undefined,
    fingerprint: canonicalSyntax(source, owner.getFullStart(), owner.getEnd(), scriptKind),
    correspondenceKey: JSON.stringify([kind, fullTitleChain, modifierChain]),
  };
}

function diagnostic(
  reason: TestDeclarationUncertaintyReason,
  node: ts.Node,
  source: ts.SourceFile,
  message: string,
): TestDeclarationDiagnostic {
  return Object.freeze({ reason, span: span(node.getStart(source), node.getEnd()), message });
}

/**
 * Parse only syntax that identifies a Vitest/Mocha-style declaration without
 * resolution or execution. Unsupported forms are evidence, never guessed rows.
 */
function analyzeInternal(input: TestDeclarationSource): { analysis: TestDeclarationAnalysis; declarations: readonly ParsedDeclaration[] } {
  const scriptKind = sourceLanguage(input.fileName);
  if (!scriptKind) {
    const empty: readonly SupportedTestDeclaration[] = [];
    const analysis = Object.freeze({
      kind: 'uncertain', declarations: empty, suites: empty,
      diagnostics: Object.freeze([Object.freeze({
        reason: 'unsupported-source-language' as const,
        span: span(0, input.bytes.byteLength),
        message: `unsupported test declaration source language: ${input.fileName}`,
      })]),
    });
    return { analysis, declarations: [] };
  }

  const text = new TextDecoder('utf-8').decode(input.bytes);
  const source = ts.createSourceFile(input.fileName, text, ts.ScriptTarget.Latest, true, scriptKind);
  const parseDiagnostics = (source as ts.SourceFile & {
    readonly parseDiagnostics: readonly ts.DiagnosticWithLocation[];
  }).parseDiagnostics;
  const diagnostics: TestDeclarationDiagnostic[] = parseDiagnostics.map((entry) => Object.freeze({
    reason: 'syntax-diagnostic' as const,
    span: span(entry.start ?? 0, (entry.start ?? 0) + (entry.length ?? 0)),
    message: ts.flattenDiagnosticMessageText(entry.messageText, '\n'),
  }));
  const declarations: ParsedDeclaration[] = [];
  const root = new Scope();
  const reportedUncertainties = new Set<string>();

  const report = (entry: TestDeclarationDiagnostic): void => {
    const key = `${entry.reason}:${entry.span.start}:${entry.span.end}`;
    if (!reportedUncertainties.has(key)) {
      reportedUncertainties.add(key);
      diagnostics.push(entry);
    }
  };

  const declareVariable = (node: ts.VariableDeclaration, scope: Scope): void => {
    if (!ts.isIdentifier(node.name)) return;
    const identity = node.initializer && ts.isIdentifier(node.initializer)
      ? scope.resolve(node.initializer.text)
      : undefined;
    const declarationList = node.parent;
    scope.bindings.set(
      node.name.text,
      ts.isVariableDeclarationList(declarationList) && declarationList.flags & ts.NodeFlags.Const ? identity : undefined,
    );
  };

  const visitFunction = (
    node: ts.FunctionLikeDeclarationBase | ts.SignatureDeclarationBase,
    scope: Scope,
    titles: readonly string[],
  ): void => {
    const functionScope = new Scope(scope);
    for (const parameter of node.parameters) if (ts.isIdentifier(parameter.name)) functionScope.bindings.set(parameter.name.text, undefined);
    if ('body' in node && node.body && ts.isBlock(node.body)) visitStatements(node.body.statements, functionScope, titles);
  };

  const visit = (node: ts.Node, scope: Scope, titles: readonly string[]): void => {
    if (ts.isFunctionLike(node)) {
      visitFunction(node, scope, titles);
      return;
    }
    if (ts.isBlock(node)) {
      visitStatements(node.statements, new Scope(scope), titles);
      return;
    }
    if (ts.isCallExpression(node)) {
      const parsed = declarationFromCall(node, source, scriptKind, titles, scope);
      if (parsed) {
        declarations.push(parsed);
        if (parsed.role === 'suite') {
          const callback = callbackBody(node);
          if (callback) visitFunction(callback, scope, parsed.titleChain);
        }
        return;
      }
      const directCallee = resolveCallee(node.expression, scope);
      const memberBase = ts.isPropertyAccessExpression(node.expression)
        ? resolveCallee(node.expression.expression, scope)
        : undefined;
      if (memberBase && ts.isPropertyAccessExpression(node.expression) && !SUPPORTED_MODIFIERS.has(node.expression.name.text)) {
        report(diagnostic('unsupported-declaration-modifier', node, source, `unsupported declaration modifier: ${node.expression.name.text}`));
      } else if (directCallee && declarationTitle(node.arguments[0]) === undefined) {
        report(diagnostic('nonliteral-declaration-title', node, source, 'test declaration title is not a literal'));
      } else if (!directCallee && expressionMentionsDeclaration(node.expression, scope)) {
        report(diagnostic('unsupported-declaration-wrapper', node, source, 'unsupported test declaration wrapper'));
      }
    }
    ts.forEachChild(node, (child) => visit(child, scope, titles));
  };

  const visitStatements = (statements: ts.NodeArray<ts.Statement>, scope: Scope, titles: readonly string[]): void => {
    for (const statement of statements) {
      if (ts.isImportDeclaration(statement)) declareImports(statement, scope);
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) declareVariable(declaration, scope);
      }
      visit(statement, scope, titles);
    }
  };

  visitStatements(source.statements, root, []);
  const occurrences = new Map<string, number>();
  const finalized = declarations.map((entry) => {
    const key = JSON.stringify(entry.titleChain);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    return Object.freeze({ ...entry, occurrence });
  });
  const publicDeclarations = Object.freeze(finalized.map(({ role: _role, fingerprint: _fingerprint, correspondenceKey: _key, ...entry }) => Object.freeze(entry)));
  const suites = Object.freeze(publicDeclarations.filter((entry) => entry.kind === 'suite'));
  const finalizedDiagnostics = Object.freeze(diagnostics);
  return {
    analysis: Object.freeze({
    kind: finalizedDiagnostics.length === 0 ? 'supported' : 'uncertain',
    declarations: publicDeclarations,
    suites,
    diagnostics: finalizedDiagnostics,
    }),
    declarations: Object.freeze(finalized),
  };
}

export function analyzeTestDeclarations(input: TestDeclarationSource): TestDeclarationAnalysis {
  return analyzeInternal(input).analysis;
}

/** Compare structural test declarations without ever treating a title as a unique key. */
export function compareTestDeclarations(base: TestDeclarationSource, head: TestDeclarationSource): TestDeclarationComparison {
  const baseParsed = analyzeInternal(base);
  const headParsed = analyzeInternal(head);
  const uncertain = [...baseParsed.analysis.diagnostics, ...headParsed.analysis.diagnostics];
  const executableBase = baseParsed.declarations.filter((entry) => entry.kind !== 'suite');
  const executableHead = headParsed.declarations.filter((entry) => entry.kind !== 'suite');
  const unmatchedBase = new Set(executableBase);
  const unmatchedHead = new Set(executableHead);
  const ambiguousBase = new Set<ParsedDeclaration>();
  const changed: SupportedTestDeclaration[] = [];

  for (const headEntry of executableHead) {
    const unchanged = [...unmatchedBase].find((baseEntry) => baseEntry.fingerprint === headEntry.fingerprint);
    if (unchanged) {
      unmatchedBase.delete(unchanged);
      unmatchedHead.delete(headEntry);
    }
  }
  for (const headEntry of unmatchedHead) {
    const candidates = [...unmatchedBase].filter((baseEntry) => baseEntry.correspondenceKey === headEntry.correspondenceKey);
    if (candidates.length === 0) {
      changed.push(Object.freeze({ ...withoutPrivateFields(headEntry), change: 'added' }));
    } else if (candidates.length === 1) {
      unmatchedBase.delete(candidates[0]!);
      changed.push(Object.freeze({ ...withoutPrivateFields(headEntry), change: 'modified' }));
    } else {
      candidates.forEach((candidate) => ambiguousBase.add(candidate));
      uncertain.push(Object.freeze({
        reason: 'uncertain-correspondence', span: headEntry.span,
        message: 'duplicate declarations have uncertain correspondence',
      }));
    }
  }
  const deleted = [...unmatchedBase]
    .filter((entry) => !ambiguousBase.has(entry))
    .map(withoutPrivateFields);
  return Object.freeze({
    kind: uncertain.length === 0 ? 'compared' : 'uncertain',
    changed: Object.freeze(changed),
    deleted: Object.freeze(deleted),
    uncertain: Object.freeze(uncertain),
  });
}

function withoutPrivateFields(entry: ParsedDeclaration): SupportedTestDeclaration {
  const { role: _role, fingerprint: _fingerprint, correspondenceKey: _key, ...publicEntry } = entry;
  return publicEntry;
}
