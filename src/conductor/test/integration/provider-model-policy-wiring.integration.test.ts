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
