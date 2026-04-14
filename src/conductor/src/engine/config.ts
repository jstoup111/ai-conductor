import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { load as loadYaml } from 'js-yaml';
import type { HarnessConfig, CustomStep, StepName } from '../types/index.js';
import { ALL_STEPS } from './steps.js';

export type ConfigError = {
  type: 'missing' | 'parse_error' | 'version_mismatch' | 'validation_error';
  message: string;
};

export type ConfigWarning = string;

export type ConfigResult =
  | { ok: true; config: HarnessConfig; warnings: ConfigWarning[] }
  | { ok: false; error: ConfigError };

export async function loadConfig(
  projectRoot: string,
  harnessVersion?: string,
): Promise<ConfigResult> {
  const configPath = join(projectRoot, '.harness', 'config.yml');

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf-8');
  } catch {
    return {
      ok: false,
      error: {
        type: 'missing',
        message: `Config file not found: ${configPath}. Run bin/migrate to create it.`,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = loadYaml(raw);
  } catch (e: unknown) {
    let message = 'Failed to parse YAML';
    if (e instanceof Error) {
      message = e.message;
      // js-yaml YAMLException includes mark with line info
      const yamlErr = e as Error & { mark?: { line?: number } };
      if (yamlErr.mark && typeof yamlErr.mark.line === 'number') {
        // mark.line is 0-based, make it 1-based for humans
        message = `YAML parse error at line ${yamlErr.mark.line + 1}: ${e.message}`;
      }
    }
    return {
      ok: false,
      error: { type: 'parse_error', message },
    };
  }

  const validation = validateConfig(parsed);
  if (!validation.ok) return validation;

  if (harnessVersion && validation.config.harness_version) {
    if (!satisfiesVersion(harnessVersion, validation.config.harness_version)) {
      return {
        ok: false,
        error: {
          type: 'version_mismatch',
          message: `Harness version ${harnessVersion} does not satisfy constraint ${validation.config.harness_version}`,
        },
      };
    }
  }

  return validation;
}

export function validateConfig(
  raw: unknown,
  projectRoot?: string,
): { ok: true; config: HarnessConfig; warnings: ConfigWarning[] } | { ok: false; error: ConfigError } {
  if (raw === null || raw === undefined) {
    return { ok: true, config: {}, warnings: [] };
  }

  if (typeof raw !== 'object') {
    return {
      ok: false,
      error: {
        type: 'validation_error',
        message: 'Config must be an object',
      },
    };
  }

  const obj = raw as Record<string, unknown>;
  const warnings: ConfigWarning[] = [];

  const knownKeys = new Set([
    'harness_version',
    'steps',
    'skills',
    'complexity',
  ]);

  for (const key of Object.keys(obj)) {
    if (!knownKeys.has(key)) {
      warnings.push(`Unknown top-level key: "${key}"`);
    }
  }

  // Validate steps.disable is array if present
  if (obj.steps !== undefined) {
    if (typeof obj.steps !== 'object' || obj.steps === null) {
      return {
        ok: false,
        error: {
          type: 'validation_error',
          message: 'steps must be an object',
        },
      };
    }
    const steps = obj.steps as Record<string, unknown>;
    if (steps.disable !== undefined && !Array.isArray(steps.disable)) {
      return {
        ok: false,
        error: {
          type: 'validation_error',
          message: 'steps.disable must be an array',
        },
      };
    }

    if (Array.isArray(steps.disable)) {
      const stepMap = new Map(ALL_STEPS.map((s) => [s.name, s]));

      for (const name of steps.disable as string[]) {
        const stepDef = stepMap.get(name as StepName);
        if (!stepDef) {
          warnings.push(`Unknown step name in steps.disable: "${name}"`);
          continue;
        }
        if (stepDef.enforcement === 'gating' || stepDef.enforcement === 'structural') {
          return {
            ok: false,
            error: {
              type: 'validation_error',
              message: `Cannot disable gating step: "${name}" (enforcement: ${stepDef.enforcement})`,
            },
          };
        }
      }
    }

    // Validate steps.add custom steps
    if (Array.isArray(steps.add)) {
      const validStepNames = new Set(ALL_STEPS.map((s) => s.name));
      for (const custom of steps.add as CustomStep[]) {
        if (!validStepNames.has(custom.after as StepName)) {
          return {
            ok: false,
            error: {
              type: 'validation_error',
              message: `Custom step "${custom.name}" references unknown after target: "${custom.after}"`,
            },
          };
        }

        if (projectRoot) {
          const skillPath = join(projectRoot, 'skills', custom.skill, 'SKILL.md');
          if (!existsSync(skillPath)) {
            return {
              ok: false,
              error: {
                type: 'validation_error',
                message: `Custom step "${custom.name}" references skill "${custom.skill}" but SKILL.md not found at ${skillPath}`,
              },
            };
          }
        }
      }
    }
  }

  return { ok: true, config: obj as HarnessConfig, warnings };
}

export function satisfiesVersion(
  installed: string,
  constraint: string,
): boolean {
  const match = constraint.match(/^>=(\d+\.\d+\.\d+)$/);
  if (!match) return true;

  const required = match[1];
  return compareVersions(installed, required) >= 0;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}
