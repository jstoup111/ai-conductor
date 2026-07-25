import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

function isConstBinding(
  declaration: ts.VariableDeclaration | undefined,
): declaration is ts.VariableDeclaration {
  return declaration !== undefined &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0;
}

function objectBindsPolicy(
  node: ts.Node | undefined,
  policyName: string | undefined,
): boolean {
  if (!node || !policyName || !ts.isObjectLiteralExpression(node)) return false;

  return node.properties.some((property) => {
    if (
      ts.isPropertyAssignment(property) &&
      property.name.getText() === 'modelPolicy'
    ) {
      return ts.isIdentifier(property.initializer) &&
        property.initializer.text === policyName;
    }
    return ts.isShorthandPropertyAssignment(property) &&
      property.name.text === 'modelPolicy' &&
      policyName === 'modelPolicy';
  });
}

it('resolves one selected inline provider key to both its provider and immutable policy before construction', async () => {
  const source = await readFile(
    new URL('../../src/index.ts', import.meta.url),
    'utf8',
  );
  const sourceFile = ts.createSourceFile(
    'index.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations: ts.VariableDeclaration[] = [];
  const calls: ts.CallExpression[] = [];
  const constructions: ts.NewExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    if (ts.isCallExpression(node)) calls.push(node);
    if (ts.isNewExpression(node)) constructions.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const providerBinding = declarations.find((declaration) => {
    if (
      !ts.isIdentifier(declaration.name) ||
      !declaration.initializer ||
      !ts.isCallExpression(declaration.initializer)
    ) return false;
    const call = declaration.initializer;
    return call.expression.getText(sourceFile) === 'registry.get' &&
      call.typeArguments?.length === 1 &&
      call.typeArguments[0].getText(sourceFile) === 'LLMProvider' &&
      call.arguments.length === 2 &&
      ts.isStringLiteral(call.arguments[0]) &&
      call.arguments[0].text === 'llm_provider' &&
      ts.isIdentifier(call.arguments[1]);
  });
  const providerName = providerBinding && ts.isIdentifier(providerBinding.name)
    ? providerBinding.name.text
    : undefined;
  const selectedKey =
    providerBinding?.initializer &&
    ts.isCallExpression(providerBinding.initializer) &&
    ts.isIdentifier(providerBinding.initializer.arguments[1])
      ? providerBinding.initializer.arguments[1].text
      : undefined;
  const selectedKeyBindings = declarations.filter(
    (declaration) =>
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === selectedKey,
  );
  const policyLookups = calls.filter((call) =>
    selectedKey !== undefined &&
    call.expression.getText(sourceFile) ===
      'resolveProviderModelPolicy' &&
    call.arguments.length === 2 &&
    ts.isIdentifier(call.arguments[0]) &&
    call.arguments[0].text === selectedKey &&
    call.arguments[1].getText(sourceFile) === 'console.warn'
  );
  const solePolicyLookup = policyLookups.length === 1
    ? policyLookups[0]
    : undefined;
  const policyBinding =
    solePolicyLookup &&
    ts.isVariableDeclaration(solePolicyLookup.parent) &&
    solePolicyLookup.parent.initializer === solePolicyLookup
      ? solePolicyLookup.parent
      : undefined;
  const policyName = policyBinding && ts.isIdentifier(policyBinding.name)
    ? policyBinding.name.text
    : undefined;
  const runnerConstruction = constructions.find(
    (node) => node.expression.getText(sourceFile) === 'DefaultStepRunner',
  );
  const conductorConstruction = constructions.find(
    (node) => node.expression.getText(sourceFile) === 'Conductor',
  );

  expect({
    selectedKeyDeclaredOnce:
      selectedKeyBindings.length === 1 &&
      isConstBinding(selectedKeyBindings[0]),
    providerBoundFromSelectedKey:
      isConstBinding(providerBinding) && providerName !== undefined,
    immutablePolicyBoundFromSelectedKey:
      isConstBinding(policyBinding) && policyName !== undefined,
    exactPolicyLookupCount: policyLookups.length,
    bothResolveBeforeConstruction:
      providerBinding !== undefined &&
      policyBinding !== undefined &&
      runnerConstruction !== undefined &&
      conductorConstruction !== undefined &&
      providerBinding.getStart() < runnerConstruction.getStart() &&
      policyBinding.getStart() < runnerConstruction.getStart() &&
      providerBinding.getStart() < conductorConstruction.getStart() &&
      policyBinding.getStart() < conductorConstruction.getStart(),
    runnerReceivesExactProviderAndPolicy:
      runnerConstruction !== undefined &&
      providerName !== undefined &&
      runnerConstruction.arguments[0] !== undefined &&
      ts.isIdentifier(runnerConstruction.arguments[0]) &&
      runnerConstruction.arguments[0].text === providerName &&
      objectBindsPolicy(runnerConstruction.arguments[3], policyName),
    conductorReceivesExactPolicy:
      conductorConstruction !== undefined &&
      objectBindsPolicy(conductorConstruction.arguments[0], policyName),
  }).toEqual({
    selectedKeyDeclaredOnce: true,
    providerBoundFromSelectedKey: true,
    immutablePolicyBoundFromSelectedKey: true,
    exactPolicyLookupCount: 1,
    bothResolveBeforeConstruction: true,
    runnerReceivesExactProviderAndPolicy: true,
    conductorReceivesExactPolicy: true,
  });
});

it('reuses one daemon provider policy for the conductor and every main or auxiliary runner', async () => {
  const source = await readFile(
    new URL('../../src/daemon-cli.ts', import.meta.url),
    'utf8',
  );
  const sourceFile = ts.createSourceFile(
    'daemon-cli.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations: ts.VariableDeclaration[] = [];
  const bindingNames: string[] = [];
  const calls: ts.CallExpression[] = [];
  const constructions: ts.NewExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      declarations.push(node);
      if (ts.isIdentifier(node.name)) bindingNames.push(node.name.text);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      bindingNames.push(node.name.text);
    }
    if (ts.isCallExpression(node)) calls.push(node);
    if (ts.isNewExpression(node)) constructions.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const registryBindings = declarations.filter(
    (declaration) =>
      ts.isIdentifier(declaration.name) &&
      declaration.initializer !== undefined &&
      ts.isNewExpression(declaration.initializer) &&
      declaration.initializer.expression.getText(sourceFile) ===
        'PluginRegistry',
  );
  const registryBinding = registryBindings.length === 1
    ? registryBindings[0]
    : undefined;
  const registryName =
    registryBinding && ts.isIdentifier(registryBinding.name)
      ? registryBinding.name.text
      : undefined;
  const providerLookups = calls.filter((call) =>
    call.expression.getText(sourceFile) === 'registry.get' &&
    call.typeArguments?.length === 1 &&
    call.typeArguments[0].getText(sourceFile) === 'LLMProvider'
  );
  const providerLookup = providerLookups.length === 1
    ? providerLookups[0]
    : undefined;
  const providerLookupUsesSelectedKey =
    providerLookup !== undefined &&
    providerLookup.arguments.length === 2 &&
    ts.isStringLiteral(providerLookup.arguments[0]) &&
    providerLookup.arguments[0].text === 'llm_provider' &&
    ts.isIdentifier(providerLookup.arguments[1]) &&
    registryName !== undefined &&
    providerLookup.expression.getText(sourceFile) === `${registryName}.get`;
  const pluginDiscoveryCalls = calls.filter(
    (call) => call.expression.getText(sourceFile) === 'discoverPlugins',
  );
  const pluginDiscoveryCall = pluginDiscoveryCalls.length === 1
    ? pluginDiscoveryCalls[0]
    : undefined;
  const pluginDiscoveryDirectlyAwaited =
    pluginDiscoveryCall !== undefined &&
    ts.isAwaitExpression(pluginDiscoveryCall.parent) &&
    pluginDiscoveryCall.parent.expression === pluginDiscoveryCall;
  const discoveryUsesExactRegistry =
    pluginDiscoveryCall !== undefined &&
    registryName !== undefined &&
    pluginDiscoveryCall.arguments.length === 3 &&
    ts.isIdentifier(pluginDiscoveryCall.arguments[0]) &&
    ts.isIdentifier(pluginDiscoveryCall.arguments[1]) &&
    ts.isIdentifier(pluginDiscoveryCall.arguments[2]) &&
    pluginDiscoveryCall.arguments[2].text === registryName;
  const globalPluginsDirName =
    discoveryUsesExactRegistry &&
    pluginDiscoveryCall &&
    ts.isIdentifier(pluginDiscoveryCall.arguments[0])
      ? pluginDiscoveryCall.arguments[0].text
      : undefined;
  const projectPluginsDirName =
    discoveryUsesExactRegistry &&
    pluginDiscoveryCall &&
    ts.isIdentifier(pluginDiscoveryCall.arguments[1])
      ? pluginDiscoveryCall.arguments[1].text
      : undefined;
  const globalPluginsDirBindings = declarations.filter(
    (declaration) =>
      globalPluginsDirName !== undefined &&
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === globalPluginsDirName,
  );
  const projectPluginsDirBindings = declarations.filter(
    (declaration) =>
      projectPluginsDirName !== undefined &&
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === projectPluginsDirName,
  );
  const globalPluginsDirBinding = globalPluginsDirBindings.length === 1
    ? globalPluginsDirBindings[0]
    : undefined;
  const projectPluginsDirBinding = projectPluginsDirBindings.length === 1
    ? projectPluginsDirBindings[0]
    : undefined;
  const directoryBindingUses = (
    declaration: ts.VariableDeclaration | undefined,
    root: 'home' | 'project',
  ): boolean => {
    if (
      !isConstBinding(declaration) ||
      !declaration.initializer ||
      !ts.isCallExpression(declaration.initializer) ||
      declaration.initializer.expression.getText(sourceFile) !== 'join'
    ) return false;
    const args = declaration.initializer.arguments;
    if (args.length !== 3) return false;
    const firstArg = ts.isParenthesizedExpression(args[0])
      ? args[0].expression
      : args[0];
    const rootMatches =
      root === 'project'
        ? ts.isIdentifier(firstArg) && firstArg.text === 'projectRoot'
        : ts.isBinaryExpression(firstArg) &&
          (
            firstArg.operatorToken.kind ===
              ts.SyntaxKind.BarBarToken ||
            firstArg.operatorToken.kind ===
              ts.SyntaxKind.QuestionQuestionToken
          ) &&
          firstArg.left.getText(sourceFile) === 'process.env.HOME' &&
          ts.isStringLiteral(firstArg.right) &&
          firstArg.right.text === '';
    return rootMatches &&
      ts.isStringLiteral(args[1]) &&
      args[1].text === '.ai-conductor' &&
      ts.isStringLiteral(args[2]) &&
      args[2].text === 'plugins';
  };
  const registerBuiltinsCalls = calls.filter(
    (call) => call.expression.getText(sourceFile) === 'registerBuiltins',
  );
  const registerBuiltinsCall = registerBuiltinsCalls.length === 1
    ? registerBuiltinsCalls[0]
    : undefined;
  const markInitializedCalls = calls.filter(
    (call) =>
      registryName !== undefined &&
      call.expression.getText(sourceFile) ===
        `${registryName}.markInitialized`,
  );
  const markInitializedCall = markInitializedCalls.length === 1
    ? markInitializedCalls[0]
    : undefined;
  const providerBinding =
    providerLookupUsesSelectedKey &&
    providerLookup &&
    ts.isVariableDeclaration(providerLookup.parent) &&
    providerLookup.parent.initializer === providerLookup
      ? providerLookup.parent
      : undefined;
  const providerName = providerBinding && ts.isIdentifier(providerBinding.name)
    ? providerBinding.name.text
    : undefined;
  const selectedKey =
    providerLookupUsesSelectedKey &&
    providerLookup &&
    ts.isIdentifier(providerLookup.arguments[1])
      ? providerLookup.arguments[1].text
      : undefined;
  const selectedKeyBindings = declarations.filter(
    (declaration) =>
      selectedKey !== undefined &&
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === selectedKey,
  );
  const providerNameBindings = bindingNames.filter(
    (name) => providerName !== undefined && name === providerName,
  );
  const policyLookups = calls.filter(
    (call) =>
      call.expression.getText(sourceFile) === 'resolveProviderModelPolicy',
  );
  const policyLookup = policyLookups.length === 1
    ? policyLookups[0]
    : undefined;
  const policyLookupUsesSelectedKeyAndLog =
    policyLookup !== undefined &&
    selectedKey !== undefined &&
    policyLookup.arguments.length === 2 &&
    ts.isIdentifier(policyLookup.arguments[0]) &&
    policyLookup.arguments[0].text === selectedKey &&
    ts.isIdentifier(policyLookup.arguments[1]) &&
    policyLookup.arguments[1].text === 'log';
  const policyBinding =
    policyLookupUsesSelectedKeyAndLog &&
    policyLookup &&
    ts.isVariableDeclaration(policyLookup.parent) &&
    policyLookup.parent.initializer === policyLookup
      ? policyLookup.parent
      : undefined;
  const policyName = policyBinding && ts.isIdentifier(policyBinding.name)
    ? policyBinding.name.text
    : undefined;
  const policyNameBindings = bindingNames.filter(
    (name) => policyName !== undefined && name === policyName,
  );
  const runnerConstructions = constructions.filter(
    (node) => node.expression.getText(sourceFile) === 'DefaultStepRunner',
  );
  const conductorConstructions = constructions.filter(
    (node) => node.expression.getText(sourceFile) === 'Conductor',
  );
  const runnerKinds = runnerConstructions.flatMap((construction) => {
    const options = construction.arguments[3];
    if (!options || !ts.isObjectLiteralExpression(options)) return [];
    const featureDesc = options.properties.find(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(sourceFile) === 'featureDesc',
    );
    if (!featureDesc) return [];
    const text = featureDesc.initializer.getText(sourceFile);
    if (text === 'item.slug') return ['main'];
    if (text.includes('setup-fix')) return ['setup-fix'];
    if (text.includes('rebase-resolution')) return ['rebase-resolution'];
    if (text.includes('ci-fix-resolution')) return ['ci-fix-resolution'];
    return [];
  });
  const allConstructions = [
    ...runnerConstructions,
    ...conductorConstructions,
  ];

  expect({
    registryConstructedOnceWithoutShadowing:
      registryBindings.length === 1 &&
      isConstBinding(registryBinding) &&
      registryName !== undefined &&
      bindingNames.filter((name) => name === registryName).length === 1,
    pluginDiscoveryCount: pluginDiscoveryCalls.length,
    pluginDiscoveryDirectlyAwaited,
    discoveryUsesExactRegistry,
    pluginDirectoriesDerivedFromHomeAndProject:
      directoryBindingUses(globalPluginsDirBinding, 'home') &&
      globalPluginsDirName !== undefined &&
      bindingNames.filter((name) => name === globalPluginsDirName).length ===
        1 &&
      directoryBindingUses(projectPluginsDirBinding, 'project') &&
      projectPluginsDirName !== undefined &&
      bindingNames.filter((name) => name === projectPluginsDirName).length ===
        1,
    registrationAndFreezeCounts: {
      registerBuiltins: registerBuiltinsCalls.length,
      markInitialized: markInitializedCalls.length,
    },
    registrationUsesExactRegistry:
      registerBuiltinsCall !== undefined &&
      registryName !== undefined &&
      registerBuiltinsCall.arguments[0] !== undefined &&
      ts.isIdentifier(registerBuiltinsCall.arguments[0]) &&
      registerBuiltinsCall.arguments[0].text === registryName,
    discoveryPrecedesRegistrationFreezeAndPolicyResolution:
      registryBinding !== undefined &&
      pluginDiscoveryCall !== undefined &&
      registerBuiltinsCall !== undefined &&
      markInitializedCall !== undefined &&
      providerLookup !== undefined &&
      policyLookup !== undefined &&
      registryBinding.getStart(sourceFile) <
        pluginDiscoveryCall.getStart(sourceFile) &&
      pluginDiscoveryCall.getStart(sourceFile) <
        registerBuiltinsCall.getStart(sourceFile) &&
      pluginDiscoveryCall.getStart(sourceFile) <
        markInitializedCall.getStart(sourceFile) &&
      pluginDiscoveryCall.getStart(sourceFile) <
        providerLookup.getStart(sourceFile) &&
      pluginDiscoveryCall.getStart(sourceFile) <
        policyLookup.getStart(sourceFile),
    selectedKeyDeclaredOnce:
      selectedKeyBindings.length === 1 &&
      bindingNames.filter((name) => name === selectedKey).length === 1 &&
      isConstBinding(selectedKeyBindings[0]),
    providerLookupCount: providerLookups.length,
    providerLookupUsesSelectedKey,
    providerBoundOnceWithoutShadowing:
      isConstBinding(providerBinding) &&
      providerName !== undefined &&
      providerNameBindings.length === 1,
    immutablePolicyLookupCount: policyLookups.length,
    policyLookupUsesSelectedKeyAndLog,
    immutablePolicyBound:
      isConstBinding(policyBinding) &&
      policyName !== undefined &&
      policyNameBindings.length === 1,
    bindingsLexicallyPrecedeEveryConsumer:
      providerBinding !== undefined &&
      policyBinding !== undefined &&
      allConstructions.every(
        (construction) =>
          providerBinding.getStart(sourceFile) <
          construction.getStart(sourceFile) &&
          policyBinding.getStart(sourceFile) <
          construction.getStart(sourceFile),
      ),
    runnerConstructionCount: runnerConstructions.length,
    allRunnersReceiveExactProviderAndPolicy:
      runnerConstructions.length === 4 &&
      runnerConstructions.every(
        (construction) =>
          providerName !== undefined &&
          construction.arguments[0] !== undefined &&
          ts.isIdentifier(construction.arguments[0]) &&
          construction.arguments[0].text === providerName &&
          objectBindsPolicy(construction.arguments[3], policyName),
      ),
    runnerKinds: runnerKinds.sort(),
    conductorConstructionCount: conductorConstructions.length,
    conductorReceivesExactPolicy:
      conductorConstructions.length === 1 &&
      objectBindsPolicy(conductorConstructions[0].arguments[0], policyName),
  }).toEqual({
    registryConstructedOnceWithoutShadowing: true,
    pluginDiscoveryCount: 1,
    pluginDiscoveryDirectlyAwaited: true,
    discoveryUsesExactRegistry: true,
    pluginDirectoriesDerivedFromHomeAndProject: true,
    registrationAndFreezeCounts: {
      registerBuiltins: 1,
      markInitialized: 1,
    },
    registrationUsesExactRegistry: true,
    discoveryPrecedesRegistrationFreezeAndPolicyResolution: true,
    selectedKeyDeclaredOnce: true,
    providerLookupCount: 1,
    providerLookupUsesSelectedKey: true,
    providerBoundOnceWithoutShadowing: true,
    immutablePolicyLookupCount: 1,
    policyLookupUsesSelectedKeyAndLog: true,
    immutablePolicyBound: true,
    bindingsLexicallyPrecedeEveryConsumer: true,
    runnerConstructionCount: 4,
    allRunnersReceiveExactProviderAndPolicy: true,
    runnerKinds: [
      'ci-fix-resolution',
      'main',
      'rebase-resolution',
      'setup-fix',
    ],
    conductorConstructionCount: 1,
    conductorReceivesExactPolicy: true,
  });
});

it('binds every production step-resolution call to the policy owned by its execution scope', async () => {
  const productionRoot = new URL('../../src/', import.meta.url);
  const sourceUrls: URL[] = [];
  const collectSources = async (directory: URL): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const entryUrl = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) {
        await collectSources(entryUrl);
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        sourceUrls.push(entryUrl);
      }
    }));
  };
  await collectSources(productionRoot);

  const configPath = fileURLToPath(new URL('../../tsconfig.json', import.meta.url));
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsedConfig = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    fileURLToPath(new URL('../../', import.meta.url)),
  );
  const program = ts.createProgram({
    rootNames: sourceUrls.map(fileURLToPath),
    options: parsedConfig.options,
  });
  const checker = program.getTypeChecker();
  const resolverSource = program.getSourceFile(
    fileURLToPath(new URL('../../src/engine/resolved-config.ts', import.meta.url)),
  );
  const resolverModule = resolverSource &&
    checker.getSymbolAtLocation(resolverSource);
  const resolverSymbol = resolverModule &&
    checker.getExportsOfModule(resolverModule).find(
      (symbol) => symbol.name === 'resolveStepConfig',
    );
  const canonicalSymbol = (node: ts.Node): ts.Symbol | undefined => {
    let symbol = checker.getSymbolAtLocation(node);
    while (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    return symbol;
  };
  const isResolverDeclarationName = (node: ts.Identifier): boolean =>
    resolverSymbol?.declarations?.some(
      (declaration) =>
        'name' in declaration &&
        declaration.name === node,
    ) ?? false;
  const isImportOrExportBinding = (node: ts.Identifier): boolean => {
    let current: ts.Node | undefined = node;
    while (
      current &&
      !ts.isSourceFile(current) &&
      !ts.isStatement(current)
    ) {
      if (
        ts.isImportSpecifier(current) ||
        ts.isImportClause(current) ||
        ts.isNamespaceImport(current) ||
        ts.isExportSpecifier(current)
      ) return true;
      current = current.parent;
    }
    return false;
  };
  const unwrapExpression = (node: ts.Expression): ts.Expression => {
    let current = node;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  };
  const referenceExpression = (node: ts.Identifier): ts.Expression => {
    if (
      ts.isPropertyAccessExpression(node.parent) &&
      node.parent.name === node
    ) {
      return node.parent;
    }
    return node;
  };
  const callForReference = (
    expression: ts.Expression,
  ): ts.CallExpression | undefined => {
    let current: ts.Expression = expression;
    while (
      current.parent &&
      (
        ts.isParenthesizedExpression(current.parent) ||
        ts.isAsExpression(current.parent) ||
        ts.isTypeAssertionExpression(current.parent) ||
        ts.isNonNullExpression(current.parent) ||
        ts.isSatisfiesExpression(current.parent)
      )
    ) {
      current = current.parent;
    }
    return ts.isCallExpression(current.parent) &&
        unwrapExpression(current.parent.expression) === unwrapExpression(current)
      ? current.parent
      : undefined;
  };
  const isComputedResolverAccess = (
    node: ts.Node,
  ): node is ts.ElementAccessExpression =>
    ts.isElementAccessExpression(node) &&
    node.argumentExpression !== undefined &&
    (
      ts.isStringLiteral(node.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(node.argumentExpression)
    ) &&
    node.argumentExpression.text === 'resolveStepConfig';
  const enclosingFunction = (
    node: ts.Node,
  ): ts.FunctionDeclaration | ts.MethodDeclaration | undefined => {
    let current: ts.Node | undefined = node.parent;
    while (
      current &&
      !ts.isFunctionDeclaration(current) &&
      !ts.isMethodDeclaration(current)
    ) {
      current = current.parent;
    }
    return current &&
        (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current))
      ? current
      : undefined;
  };
  const enclosingClass = (
    node: ts.Node,
  ): ts.ClassDeclaration | ts.ClassExpression | undefined => {
    let current: ts.Node | undefined = node.parent;
    while (
      current &&
      !ts.isClassDeclaration(current) &&
      !ts.isClassExpression(current)
    ) {
      current = current.parent;
    }
    return current &&
        (ts.isClassDeclaration(current) || ts.isClassExpression(current))
      ? current
      : undefined;
  };
  const parameterContaining = (
    declaration: ts.Declaration,
  ): ts.ParameterDeclaration | undefined => {
    let current: ts.Node | undefined = declaration;
    while (current && !ts.isParameter(current)) current = current.parent;
    return current && ts.isParameter(current) ? current : undefined;
  };
  const policyProvenance = (
    argument: ts.Expression | undefined,
    call: ts.CallExpression,
  ): string => {
    if (!argument) return '<missing>';
    const expression = unwrapExpression(argument);
    const scope = enclosingFunction(call);
    if (ts.isIdentifier(expression)) {
      const symbol = canonicalSymbol(expression);
      const declaration = symbol?.declarations?.find((candidate) => {
        const parameter = parameterContaining(candidate);
        return parameter !== undefined && parameter.parent === scope;
      });
      const type = checker.typeToString(checker.getTypeAtLocation(expression));
      if (declaration) return `parameter:${expression.text}:${type}`;

      const optionBinding = symbol?.declarations?.find(
        (candidate): candidate is ts.BindingElement => {
          if (
            !scope ||
            !ts.isBindingElement(candidate) ||
            !ts.isObjectBindingPattern(candidate.parent) ||
            !ts.isVariableDeclaration(candidate.parent.parent)
          ) return false;
          const variable = candidate.parent.parent;
          const source = variable.initializer &&
            unwrapExpression(variable.initializer);
          if (!source || !ts.isIdentifier(source)) return false;
          const sourceSymbol = canonicalSymbol(source);
          const parameter = scope.parameters.find(
            (scopeParameter) =>
              ts.isIdentifier(scopeParameter.name) &&
              canonicalSymbol(scopeParameter.name) === sourceSymbol &&
              checker.typeToString(
                  checker.getTypeAtLocation(scopeParameter.name),
                ) === 'VerifierDispatchOptions',
          );
          const defaultPolicy = candidate.initializer &&
            unwrapExpression(candidate.initializer);
          const defaultSymbol = defaultPolicy &&
              ts.isIdentifier(defaultPolicy)
            ? canonicalSymbol(defaultPolicy)
            : undefined;
          const canonicalClaudeDefault = defaultSymbol?.declarations?.some(
            (defaultDeclaration) =>
              ts.isVariableDeclaration(defaultDeclaration) &&
              ts.isIdentifier(defaultDeclaration.name) &&
              defaultDeclaration.name.text === 'CLAUDE_MODEL_POLICY' &&
              defaultDeclaration.getSourceFile().fileName.endsWith(
                '/engine/provider-model-policy.ts',
              ),
          );
          return parameter !== undefined && canonicalClaudeDefault === true;
        },
      );
      return optionBinding && type === 'ProviderModelPolicy'
        ? `option:${expression.text}:${type}`
        : `unproven:${expression.getText()}:${type}`;
    }
    if (
      ts.isPropertyAccessExpression(expression) &&
      expression.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      const symbol = canonicalSymbol(expression.name);
      const owner = enclosingClass(call);
      const declaration = symbol?.declarations?.find((candidate) => {
        if (ts.isPropertyDeclaration(candidate)) {
          return candidate.parent === owner;
        }
        return ts.isParameter(candidate) &&
          ts.isConstructorDeclaration(candidate.parent) &&
          candidate.parent.parent === owner;
      });
      const type = checker.typeToString(checker.getTypeAtLocation(expression));
      const ownerName = owner?.name?.text ?? '<anonymous>';
      return declaration
        ? `property:${ownerName}.${expression.name.text}:${type}`
        : `unproven:${expression.getText()}:${type}`;
    }
    return `unproven:${expression.getText()}:${
      checker.typeToString(checker.getTypeAtLocation(expression))
    }`;
  };

  const callSites: Array<{
    file: string;
    scope: string;
    argumentCount: number;
    policyProvenance: string;
  }> = [];
  const unexpectedReferences: string[] = [];
  const recordResolverReference = (
    expression: ts.Expression,
    sourceFile: ts.SourceFile,
    file: string,
    requiresCanonicalSymbol: boolean,
  ): void => {
    if (
      requiresCanonicalSymbol &&
      canonicalSymbol(expression) !== resolverSymbol
    ) {
      unexpectedReferences.push(
        `${file}:computed-unresolved:${
          sourceFile.getLineAndCharacterOfPosition(expression.getStart()).line +
          1
        }`,
      );
      return;
    }
    const call = callForReference(expression);
    if (!call) {
      unexpectedReferences.push(
        `${file}:${sourceFile.getLineAndCharacterOfPosition(expression.getStart()).line + 1}`,
      );
      return;
    }
    const scopeNode = enclosingFunction(call);
    const scope = scopeNode?.name?.getText(sourceFile) ?? '<unknown>';
    callSites.push({
      file,
      scope,
      argumentCount: call.arguments.length,
      policyProvenance: policyProvenance(call.arguments[2], call),
    });
  };
  for (const sourceUrl of sourceUrls.sort(
    (left, right) => left.pathname.localeCompare(right.pathname),
  )) {
    const filePath = fileURLToPath(sourceUrl);
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) continue;
    const file = sourceUrl.pathname.slice(productionRoot.pathname.length);
    const visit = (node: ts.Node): void => {
      if (isComputedResolverAccess(node)) {
        recordResolverReference(node, sourceFile, file, true);
      } else if (
        ts.isIdentifier(node) &&
        canonicalSymbol(node) === resolverSymbol &&
        !isResolverDeclarationName(node) &&
        !isImportOrExportBinding(node)
      ) {
        recordResolverReference(
          referenceExpression(node),
          sourceFile,
          file,
          false,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  const computedMutation = ts.createSourceFile(
    'computed-resolver-mutation.ts',
    `
      resolverNamespace['resolveStepConfig'](
        step,
        phase,
        modelPolicy,
        config,
        options,
      );
      const escapedResolver = resolverNamespace[\`resolveStepConfig\`];
    `,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const computedMutationReferences: string[] = [];
  const visitComputedMutation = (node: ts.Node): void => {
    if (isComputedResolverAccess(node)) {
      computedMutationReferences.push(
        callForReference(node) ? 'computed-call' : 'computed-non-call',
      );
    }
    ts.forEachChild(node, visitComputedMutation);
  };
  visitComputedMutation(computedMutation);

  expect(
    {
      callSites: callSites.sort((left, right) =>
        `${left.file}#${left.scope}`.localeCompare(
          `${right.file}#${right.scope}`,
        )
      ),
      computedMutationReferences,
      unexpectedReferences: unexpectedReferences.sort(),
    },
  ).toEqual({
    callSites: [
      {
        file: 'engine/attribution-lane.ts',
        scope: 'dispatchAttributionVerifier',
        argumentCount: 5,
        policyProvenance: 'option:modelPolicy:ProviderModelPolicy',
      },
      {
        file: 'engine/conductor.ts',
        scope: 'resolveGroupMembership',
        argumentCount: 5,
        policyProvenance: 'parameter:modelPolicy:ProviderModelPolicy',
      },
      {
        file: 'engine/conductor.ts',
        scope: 'run',
        argumentCount: 5,
        policyProvenance: 'property:Conductor.modelPolicy:ProviderModelPolicy',
      },
      {
        file: 'engine/step-runners.ts',
        scope: 'resolvedConfigFor',
        argumentCount: 5,
        policyProvenance:
          'property:DefaultStepRunner.modelPolicy:ProviderModelPolicy',
      },
    ],
    computedMutationReferences: [
      'computed-call',
      'computed-non-call',
    ],
    unexpectedReferences: [],
  });
});
