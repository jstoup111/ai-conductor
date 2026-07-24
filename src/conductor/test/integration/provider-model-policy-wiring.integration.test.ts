import { readFile } from 'node:fs/promises';
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
