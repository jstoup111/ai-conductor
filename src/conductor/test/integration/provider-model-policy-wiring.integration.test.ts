import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('does not retain run-global model-policy authority in the conductor', async () => {
  const source = await readFile(
    new URL('../../src/engine/conductor.ts', import.meta.url),
    'utf8',
  );

  expect(source).not.toMatch(/\bthis\.modelPolicy\b/);
  expect(source).toMatch(
    /resolveGroupMembership\([\s\S]*?this\.modelPolicyForStep\(step\.name\),[\s\S]*?this\.config,[\s\S]*?\)/,
  );
});

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

it('composes one ordered provider context across the interactive run after registry freeze', async () => {
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

  const binding = (name: string) =>
    declarations.find(
      (declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === name,
    );
  const contextBinding = binding('providerExecution');
  const contextObject =
    contextBinding?.initializer &&
    ts.isObjectLiteralExpression(contextBinding.initializer)
      ? contextBinding.initializer
      : undefined;
  const contextProperties = new Map(
    contextObject?.properties
      .filter(ts.isPropertyAssignment)
      .map((property) => [
        property.name.getText(sourceFile),
        property.initializer.getText(sourceFile),
      ]) ?? [],
  );
  const compatibilityRuntime = binding('compatibilityRuntime');
  const runnerConstruction = constructions.find(
    (node) => node.expression.getText(sourceFile) === 'DefaultStepRunner',
  );
  const conductorConstruction = constructions.find(
    (node) => node.expression.getText(sourceFile) === 'Conductor',
  );
  const runnerOptions =
    runnerConstruction?.arguments?.[3] &&
    ts.isObjectLiteralExpression(runnerConstruction.arguments[3])
      ? runnerConstruction.arguments[3]
      : undefined;
  const conductorOptions =
    conductorConstruction?.arguments?.[0] &&
    ts.isObjectLiteralExpression(conductorConstruction.arguments[0])
      ? conductorConstruction.arguments[0]
      : undefined;
  const propertyText = (
    object: ts.ObjectLiteralExpression | undefined,
    name: string,
  ) =>
    object?.properties.find((property) => property.name?.getText(sourceFile) === name)
      ?.getText(sourceFile);
  const preludeCall = calls.find(
    (call) => call.expression.getText(sourceFile) === 'runProjectPrelude',
  );
  const validationCall = calls.find(
    (call) =>
      call.expression.getText(sourceFile) ===
      'validateRegisteredProviderSelections',
  );
  const markInitializedCall = calls.find(
    (call) => call.expression.getText(sourceFile) === 'registry.markInitialized',
  );
  const subscriberStart = calls.find(
    (call) => call.expression.getText(sourceFile) === 'subscriber.start',
  );
  const runtimeCalls = calls.filter(
    (call) => call.expression.getText(sourceFile) === 'createProviderRuntimeSet',
  );
  const validationOptions =
    validationCall?.arguments[0] &&
    ts.isObjectLiteralExpression(validationCall.arguments[0])
      ? validationCall.arguments[0]
      : undefined;
  const sessionConstructions = constructions.filter(
    (node) => node.expression.getText(sourceFile) === 'ProviderSessionStore',
  );
  const compact = (text: string | undefined) =>
    text?.replace(/\s+/g, '').replace(/,\)/g, ')');

  expect({
    selectedProviderKeyBindings: declarations.filter(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'selectedProviderKey',
    ).length,
    configuredProviderNormalization:
      binding('configuredProviders')?.initializer?.getText(sourceFile),
    validationConfig: propertyText(validationOptions, 'config'),
    validationRegistry: propertyText(
      validationOptions,
      'registeredProviders',
    ),
    runtimeRegistry: runtimeCalls[0]?.arguments[0]?.getText(sourceFile),
    contextIsConst: isConstBinding(contextBinding),
    contextProperties: Object.fromEntries(contextProperties),
    compatibilityRuntime: compact(
      compatibilityRuntime?.initializer?.getText(sourceFile),
    ),
    runtimeSetConstructionCount: runtimeCalls.length,
    sessionStoreConstructionCount: sessionConstructions.length,
    runnerProvider: runnerConstruction?.arguments?.[0]?.getText(sourceFile),
    runnerContext: propertyText(runnerOptions, 'providerExecution'),
    conductorContext: propertyText(conductorOptions, 'providerExecution'),
    preludeContext:
      preludeCall?.arguments[4] &&
      ts.isObjectLiteralExpression(preludeCall.arguments[4])
        ? propertyText(preludeCall.arguments[4], 'providerExecution')
        : undefined,
    startupOrder:
      markInitializedCall !== undefined &&
      validationCall !== undefined &&
      contextBinding !== undefined &&
      subscriberStart !== undefined &&
      markInitializedCall.getStart() < validationCall.getStart() &&
      validationCall.getStart() < contextBinding.getStart() &&
      contextBinding.getStart() < subscriberStart.getStart(),
  }).toEqual({
    selectedProviderKeyBindings: 0,
    configuredProviderNormalization:
      'normalizeProviderSelection(config?.llm_provider)',
    validationConfig: 'config: config ?? {}',
    validationRegistry:
      "registeredProviders: registry.list('llm_provider')",
    runtimeRegistry: 'registry',
    contextIsConst: true,
    contextProperties: {
      configuredProviders: 'configuredProviders',
      runtimes: 'createProviderRuntimeSet(registry, console.warn)',
      sessions: 'new ProviderSessionStore()',
      config: 'config',
      modelOverride: 'opts.model',
      effortOverride: 'opts.effort',
      onAttempt:
        "(step, attempt) =>\n      events.emit({ type: 'provider_attempt', step, ...attempt })",
      warn: '(_message, transition) => events.emit(transition)',
      withCandidateSafety: 'createCandidateSafetyBoundary()',
    },
    compatibilityRuntime:
      'providerExecution.runtimes.get(providerExecution.configuredProviders[0])'.replace(
        /\s+/g,
        '',
      ),
    runtimeSetConstructionCount: 1,
    sessionStoreConstructionCount: 1,
    runnerProvider: 'compatibilityRuntime.provider',
    runnerContext: 'providerExecution',
    conductorContext: 'providerExecution',
    preludeContext: 'providerExecution',
    startupOrder: true,
  });
});

it('composes isolated provider execution state for every daemon feature after one registry freeze', async () => {
  const [daemonSource, runnerSource] = await Promise.all([
    readFile(new URL('../../src/daemon-cli.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/engine/daemon-runner.ts', import.meta.url), 'utf8'),
  ]);
  const daemonFile = ts.createSourceFile(
    'daemon-cli.ts',
    daemonSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(daemonFile);
  const binding = (name: string) =>
    declarations.find(
      (declaration) =>
        ts.isIdentifier(declaration.name) && declaration.name.text === name,
    );
  const factory = binding('createProviderExecution')?.initializer;
  const factoryFunction =
    factory && ts.isArrowFunction(factory) ? factory : undefined;
  const factoryState =
    factoryFunction?.body && ts.isParenthesizedExpression(factoryFunction.body)
      ? factoryFunction.body.expression
      : undefined;
  const factoryProperties =
    factoryState && ts.isObjectLiteralExpression(factoryState)
      ? factoryState.properties
      : [];
  const factoryProperty = (name: string) =>
    factoryProperties.find(
      (property) => property.name?.getText(daemonFile) === name,
    );
  const runtimeProperty = factoryProperty('runtimes');
  const sessionsProperty = factoryProperty('sessions');
  const featureRun = binding('beginFeatureRun')?.initializer;
  const featureRunFunction =
    featureRun && ts.isArrowFunction(featureRun) ? featureRun : undefined;
  const featureReturn = featureRunFunction?.body && ts.isBlock(featureRunFunction.body)
    ? featureRunFunction.body.statements.find(ts.isReturnStatement)?.expression
    : undefined;
  const featureProperties =
    featureReturn && ts.isObjectLiteralExpression(featureReturn)
      ? featureReturn.properties
      : [];
  const featureExecution = featureProperties.find(
    (property) => property.name?.getText(daemonFile) === 'providerExecution',
  );
  const compact = daemonSource.replace(/\s+/g, ' ');
  const featureBody = runnerSource.slice(
    runnerSource.indexOf('return async (item: BacklogItem)'),
    runnerSource.indexOf('async function emitDaemonSignal'),
  );
  const mainRunBody = daemonSource.slice(
    daemonSource.indexOf('const runConductorInWorktree'),
    daemonSource.indexOf('// Task 15: Production wiring of setup-failure triage'),
  );
  const setupBody = daemonSource.slice(
    daemonSource.indexOf('const runSetupTriage'),
    daemonSource.indexOf('const deps = makeFeatureRunnerDeps'),
  );
  const rebaseBody = daemonSource.slice(
    daemonSource.indexOf('const resolver: RebaseResolver'),
    daemonSource.indexOf('// Run the full resolution pipeline'),
  );
  const ciBody = daemonSource.slice(
    daemonSource.indexOf('const ciFixDispatcher'),
    daemonSource.indexOf('const outcome = await runCiFix'),
  );

  expect({
    globalSelectedProviderBindings:
      daemonSource.match(/\bconst selectedProviderKey\b/g)?.length ?? 0,
    globalProviderPolicyLookups:
      daemonSource.match(/\bresolveProviderModelPolicy\(/g)?.length ?? 0,
    configuredOrder:
      compact.includes(
        'const configuredProviders = normalizeProviderSelection(config?.llm_provider);',
      ),
    validatesFrozenRegistryBeforeFactory:
      daemonSource.indexOf('registry.markInitialized()') <
        daemonSource.indexOf('validateRegisteredProviderSelections({') &&
        daemonSource.indexOf('validateRegisteredProviderSelections({') <
        daemonSource.indexOf('const createProviderExecution'),
    factoryDefaultsToGlobalRuntimeLogger:
      factoryFunction?.parameters[1]?.initializer?.getText(daemonFile) === 'log' &&
      runtimeProperty !== undefined &&
      ts.isPropertyAssignment(runtimeProperty) &&
      ts.isCallExpression(runtimeProperty.initializer) &&
      runtimeProperty.initializer.expression.getText(daemonFile) ===
        'createProviderRuntimeSet' &&
      runtimeProperty.initializer.arguments[0]?.getText(daemonFile) ===
        'registry' &&
      runtimeProperty.initializer.arguments[1]?.getText(daemonFile) ===
        factoryFunction.parameters[1]?.name.getText(daemonFile) &&
      sessionsProperty !== undefined &&
      ts.isPropertyAssignment(sessionsProperty) &&
      ts.isNewExpression(sessionsProperty.initializer) &&
      sessionsProperty.initializer.expression.getText(daemonFile) ===
        'ProviderSessionStore',
    featureInjectsScopedRuntimeLogger:
      featureExecution !== undefined &&
      ts.isPropertyAssignment(featureExecution) &&
      ts.isCallExpression(featureExecution.initializer) &&
      featureExecution.initializer.expression.getText(daemonFile) ===
        'createProviderExecution' &&
      featureExecution.initializer.arguments[1]?.getText(daemonFile) ===
        'featureLog',
    factoryInjectedAtFeatureBoundary:
      /providerExecution:\s*createProviderExecution/.test(daemonSource) &&
      (featureBody.match(/deps\.providerExecution\?\.\(\)/g)?.length ?? 0) === 1,
    mainRunnerContext:
      /featureDesc:\s*item\.slug,[\s\S]*?providerExecution,[\s\S]*?\}\s*,?\s*\);/.test(
        mainRunBody,
      ),
    conductorContext:
      /const conductor = new Conductor\(\{[\s\S]*?providerExecution,[\s\S]*?\}\);/.test(
        mainRunBody,
      ),
    setupRecoveryContext:
      /featureDesc:\s*`setup-fix-\$\{item\.slug\}`,[\s\S]*?providerExecution,[\s\S]*?\}\s*,?\s*\);/.test(
        setupBody,
      ),
    rebaseRecoveryContext:
      (rebaseBody.match(
        /const providerExecution = createSlugScopedProviderExecution\(entry\.slug\);/g,
      )?.length ?? 0) === 1 &&
      /featureDesc:\s*`rebase-resolution-\$\{entry\.slug\}`,[\s\S]*?providerExecution,[\s\S]*?\}\s*,?\s*\);/.test(
        rebaseBody,
      ),
    ciRecoveryContext:
      (ciBody.match(
        /const providerExecution = createSlugScopedProviderExecution\(ctx\.entry\.slug\);/g,
      )?.length ?? 0) === 1 &&
      /featureDesc:\s*`ci-fix-resolution-\$\{ctx\.entry\.slug\}`,[\s\S]*?providerExecution,[\s\S]*?\}\s*,?\s*\);/.test(
        ciBody,
      ),
  }).toEqual({
    globalSelectedProviderBindings: 0,
    globalProviderPolicyLookups: 0,
    configuredOrder: true,
    validatesFrozenRegistryBeforeFactory: true,
    factoryDefaultsToGlobalRuntimeLogger: true,
    featureInjectsScopedRuntimeLogger: true,
    factoryInjectedAtFeatureBoundary: true,
    mainRunnerContext: true,
    conductorContext: true,
    setupRecoveryContext: true,
    rebaseRecoveryContext: true,
    ciRecoveryContext: true,
  });
});

it('freezes one daemon registry without retaining legacy global provider authority', async () => {
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
  const runtimeSetCalls = calls.filter(
    (call) => call.expression.getText(sourceFile) === 'createProviderRuntimeSet',
  );
  const runtimeSetCall = runtimeSetCalls.length === 1
    ? runtimeSetCalls[0]
    : undefined;
  const runProviderBinding = declarations.find(
    (declaration) =>
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === 'runProvider' &&
      declaration.initializer !== undefined &&
      declaration.initializer.getText(sourceFile) ===
        'selectedRuntime.provider',
  );
  const runPolicyBinding = declarations.find(
    (declaration) =>
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === 'runModelPolicy' &&
      declaration.initializer !== undefined &&
      declaration.initializer.getText(sourceFile) ===
        'selectedRuntime.policy',
  );
  const runnerKind = (construction: ts.NewExpression): string | undefined => {
    const options = construction.arguments?.[3];
    if (!options || !ts.isObjectLiteralExpression(options)) return undefined;
    const featureDesc = options.properties.find(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(sourceFile) === 'featureDesc',
    );
    if (!featureDesc) return undefined;
    const text = featureDesc.initializer.getText(sourceFile);
    if (text === 'item.slug') return 'main';
    if (text.includes('setup-fix')) return 'setup-fix';
    if (text.includes('rebase-resolution')) return 'rebase-resolution';
    if (text.includes('ci-fix-resolution')) return 'ci-fix-resolution';
    return undefined;
  };
  const runnerKinds = runnerConstructions.flatMap((construction) => {
    const kind = runnerKind(construction);
    return kind ? [kind] : [];
  });
  const mainRunner = runnerConstructions.find(
    (construction) => runnerKind(construction) === 'main',
  );
  const auxiliaryRunners = runnerConstructions.filter(
    (construction) => runnerKind(construction) !== 'main',
  );
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
    discoveryPrecedesRegistrationFreezeAndRuntimeFactory:
      registryBinding !== undefined &&
      pluginDiscoveryCall !== undefined &&
      registerBuiltinsCall !== undefined &&
      markInitializedCall !== undefined &&
      runtimeSetCall !== undefined &&
      registryBinding.getStart(sourceFile) <
        pluginDiscoveryCall.getStart(sourceFile) &&
      pluginDiscoveryCall.getStart(sourceFile) <
        registerBuiltinsCall.getStart(sourceFile) &&
      registerBuiltinsCall.getStart(sourceFile) <
        markInitializedCall.getStart(sourceFile) &&
      markInitializedCall.getStart(sourceFile) <
        runtimeSetCall.getStart(sourceFile),
    selectedKeyAuthorityAbsent: selectedKeyBindings.length === 0,
    globalProviderLookupAuthorityAbsent: providerLookups.length === 0,
    globalPolicyLookupAuthorityAbsent: policyLookups.length === 0,
    globalProviderAndPolicyBindingsAbsent:
      providerBinding === undefined &&
      policyBinding === undefined &&
      providerNameBindings.length === 0 &&
      policyNameBindings.length === 0,
    runnerConstructionCount: runnerConstructions.length,
    auxiliaryRunnersAvoidLegacyProviderAndPolicy:
      auxiliaryRunners.length === 3 &&
      auxiliaryRunners.every(
        (construction) =>
          providerName === undefined ||
          construction.arguments?.[0] === undefined ||
          !ts.isIdentifier(construction.arguments[0]) ||
          construction.arguments[0].text !== providerName ||
          !objectBindsPolicy(construction.arguments?.[3], policyName),
      ),
    legacyMainRuntimeBindingsAbsent:
      runProviderBinding === undefined && runPolicyBinding === undefined,
    runnerKinds: runnerKinds.sort(),
    conductorConstructionCount: conductorConstructions.length,
    conductorAvoidsLegacyRuntimePolicyBinding:
      conductorConstructions.length === 1 &&
      !objectBindsPolicy(
        conductorConstructions[0].arguments?.[0],
        'runModelPolicy',
      ),
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
    discoveryPrecedesRegistrationFreezeAndRuntimeFactory: true,
    selectedKeyAuthorityAbsent: true,
    globalProviderLookupAuthorityAbsent: true,
    globalPolicyLookupAuthorityAbsent: true,
    globalProviderAndPolicyBindingsAbsent: true,
    runnerConstructionCount: 4,
    auxiliaryRunnersAvoidLegacyProviderAndPolicy: true,
    legacyMainRuntimeBindingsAbsent: true,
    runnerKinds: [
      'ci-fix-resolution',
      'main',
      'rebase-resolution',
      'setup-fix',
    ],
    conductorConstructionCount: 1,
    conductorAvoidsLegacyRuntimePolicyBinding: true,
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
    rootNames: sourceUrls.map((url) => fileURLToPath(url)),
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
      if (optionBinding && type === 'ProviderModelPolicy') {
        return `option:${expression.text}:${type}`;
      }

      const stepPolicyBinding = symbol?.declarations?.find(
        (candidate): candidate is ts.VariableDeclaration => {
          if (
            !ts.isVariableDeclaration(candidate) ||
            !candidate.initializer ||
            !ts.isCallExpression(candidate.initializer)
          ) return false;
          const callee = unwrapExpression(candidate.initializer.expression);
          return ts.isPropertyAccessExpression(callee) &&
            callee.expression.kind === ts.SyntaxKind.ThisKeyword &&
            callee.name.text === 'modelPolicyForStep';
        },
      );
      return stepPolicyBinding && type === 'ProviderModelPolicy'
        ? `step-resolver:Conductor.modelPolicyForStep:${type}`
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
        policyProvenance:
          'step-resolver:Conductor.modelPolicyForStep:ProviderModelPolicy',
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
