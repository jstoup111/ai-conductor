import { pathToFileURL } from 'node:url';

/**
 * The subset of Pi's ExtensionAPI the harness extension touches, transcribed from
 * @earendil-works/pi-coding-agent dist/core/extensions/types.d.ts (registerFlag returns
 * void, getFlag reads by flag NAME, execute is (toolCallId, params, signal, onUpdate, ctx)).
 * Pi is not an engine dependency, so these signatures are copied rather than imported;
 * keep them in step with the installed package.
 */
export interface FakeAgentToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: unknown;
  terminate?: boolean;
}
export interface FakeToolDefinition {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: ((update: unknown) => void) | undefined,
    ctx: { cwd: string },
  ): Promise<FakeAgentToolResult>;
}
export interface FakeExtensionApi {
  registerFlag(
    name: string,
    options: { description?: string; type: 'boolean'; default?: boolean } | { description?: string; type: 'string'; default?: string },
  ): void;
  getFlag(name: string): boolean | string | undefined;
  registerTool(tool: FakeToolDefinition): void;
}

export function createFakeExtensionApi(flagValues: Record<string, string | boolean> = {}) {
  const registeredFlags: string[] = [];
  const tools: FakeToolDefinition[] = [];
  const api: FakeExtensionApi = {
    registerFlag(name) { registeredFlags.push(name); },
    // Pi answers only for registered flags (loader.js getFlag).
    getFlag(name) { return registeredFlags.includes(name) ? flagValues[name] : undefined; },
    registerTool(tool) { tools.push(tool); },
  };
  return { api, registeredFlags, tools };
}

/** Load the materialized asset's default export the way Pi does: from the file on disk. */
export async function loadExtensionFactory(assetPath: string): Promise<(pi: FakeExtensionApi) => unknown> {
  const module = await import(/* @vite-ignore */ `${pathToFileURL(assetPath).href}?t=${Date.now()}`);
  return module.default as (pi: FakeExtensionApi) => unknown;
}
