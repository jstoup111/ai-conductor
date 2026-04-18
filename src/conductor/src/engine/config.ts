import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, isAbsolute, resolve as resolvePath } from 'path';
import { load as loadYaml } from 'js-yaml';
import type { HarnessConfig, StepConfig, EffortLevel } from '../types/config.js';
import type { StepName, EnforcementLevel } from '../types/index.js';
import { ALL_STEPS } from './steps.js';

export type ConfigError = {
  type: 'missing' | 'parse_error' | 'version_mismatch' | 'validation_error';
  message: string;
};

export type ConfigWarning = string;

export type ConfigResult =
  | { ok: true; config: HarnessConfig; warnings: ConfigWarning[] }
  | { ok: false; error: ConfigError };

const VALID_PHASES = new Set(['SETUP', 'UNDERSTAND', 'DECIDE', 'BUILD', 'SHIP']);
const VALID_EFFORTS = new Set<EffortLevel>(['low', 'medium', 'high', 'xhigh', 'max']);
const VALID_ENFORCEMENTS = new Set<EnforcementLevel>(['structural', 'advisory', 'gating']);

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
      const yamlErr = e as Error & { mark?: { line?: number } };
      if (yamlErr.mark && typeof yamlErr.mark.line === 'number') {
        message = `YAML parse error at line ${yamlErr.mark.line + 1}: ${e.message}`;
      }
    }
    return { ok: false, error: { type: 'parse_error', message } };
  }

  const validation = validateConfig(parsed, projectRoot);
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
): ConfigResult {
  if (raw === null || raw === undefined) {
    return { ok: true, config: {}, warnings: [] };
  }

  if (typeof raw !== 'object') {
    return {
      ok: false,
      error: { type: 'validation_error', message: 'Config must be an object' },
    };
  }

  const obj = raw as Record<string, unknown>;
  const warnings: ConfigWarning[] = [];

  const knownTopLevelKeys = new Set([
    'harness_version',
    'defaults',
    'phases',
    'steps',
    'complexity',
  ]);
  for (const key of Object.keys(obj)) {
    if (!knownTopLevelKeys.has(key)) {
      warnings.push(`Unknown top-level key: "${key}"`);
    }
  }

  // defaults
  if (obj.defaults !== undefined) {
    const err = validateEffortAndModelBag(obj.defaults, 'defaults');
    if (err) return { ok: false, error: err };
  }

  // phases
  if (obj.phases !== undefined) {
    if (!isPlainObject(obj.phases)) {
      return {
        ok: false,
        error: { type: 'validation_error', message: 'phases must be an object' },
      };
    }
    for (const [phase, value] of Object.entries(obj.phases)) {
      if (!VALID_PHASES.has(phase)) {
        warnings.push(`Unknown phase: "${phase}"`);
        continue;
      }
      const err = validateEffortAndModelBag(value, `phases.${phase}`);
      if (err) return { ok: false, error: err };
    }
  }

  // steps
  if (obj.steps !== undefined) {
    if (!isPlainObject(obj.steps)) {
      return {
        ok: false,
        error: { type: 'validation_error', message: 'steps must be an object' },
      };
    }

    const builtInNames = new Set(ALL_STEPS.map((s) => s.name));
    const stepDefs = new Map(ALL_STEPS.map((s) => [s.name, s]));

    for (const [name, value] of Object.entries(obj.steps as Record<string, unknown>)) {
      if (!isPlainObject(value)) {
        return {
          ok: false,
          error: {
            type: 'validation_error',
            message: `steps.${name} must be an object`,
          },
        };
      }
      const cfg = value as Record<string, unknown>;
      const knownStepKeys = new Set([
        'model',
        'effort',
        'max_retries',
        'disable',
        'skill',
        'hooks',
        'by_tier',
        'after',
        'enforcement',
      ]);
      for (const k of Object.keys(cfg)) {
        if (!knownStepKeys.has(k)) warnings.push(`Unknown key in steps.${name}: "${k}"`);
      }

      // Common validations
      if (cfg.effort !== undefined && !VALID_EFFORTS.has(cfg.effort as EffortLevel)) {
        return errVal(`steps.${name}.effort must be low|medium|high|xhigh|max`);
      }
      if (cfg.by_tier !== undefined) {
        const byTierErr = validateByTier(cfg.by_tier, `steps.${name}.by_tier`);
        if (byTierErr) return { ok: false, error: byTierErr };
      }
      if (cfg.max_retries !== undefined && typeof cfg.max_retries !== 'number') {
        return errVal(`steps.${name}.max_retries must be a number`);
      }
      if (cfg.disable !== undefined && typeof cfg.disable !== 'boolean') {
        return errVal(`steps.${name}.disable must be a boolean`);
      }
      if (cfg.model !== undefined && typeof cfg.model !== 'string') {
        return errVal(`steps.${name}.model must be a string`);
      }
      if (cfg.skill !== undefined && typeof cfg.skill !== 'string') {
        return errVal(`steps.${name}.skill must be a string path`);
      }
      if (cfg.hooks !== undefined) {
        if (!isPlainObject(cfg.hooks)) {
          return errVal(`steps.${name}.hooks must be an object`);
        }
        const hooks = cfg.hooks as Record<string, unknown>;
        for (const h of ['before', 'after']) {
          if (hooks[h] !== undefined && typeof hooks[h] !== 'string') {
            return errVal(`steps.${name}.hooks.${h} must be a string path`);
          }
        }
      }

      const isCustom = !builtInNames.has(name as StepName);

      if (isCustom) {
        // Custom steps need both `after` and `skill`.
        if (typeof cfg.after !== 'string') {
          return errVal(`Custom step "${name}" requires 'after: <existing-step>'`);
        }
        if (!builtInNames.has(cfg.after as StepName)) {
          return errVal(
            `Custom step "${name}" references unknown after target: "${cfg.after}"`,
          );
        }
        if (typeof cfg.skill !== 'string') {
          return errVal(`Custom step "${name}" requires 'skill: <path-to-SKILL.md>'`);
        }
        if (cfg.enforcement !== undefined && !VALID_ENFORCEMENTS.has(cfg.enforcement as EnforcementLevel)) {
          return errVal(
            `Custom step "${name}".enforcement must be structural|advisory|gating`,
          );
        }
        if (projectRoot && typeof cfg.skill === 'string') {
          const skillPath = isAbsolute(cfg.skill)
            ? cfg.skill
            : resolvePath(projectRoot, cfg.skill);
          if (!existsSync(skillPath)) {
            return errVal(
              `Custom step "${name}" skill file not found: ${skillPath}`,
            );
          }
        }
      } else {
        // Built-in step: 'after' / 'enforcement' are meaningless — warn.
        if (cfg.after !== undefined) {
          warnings.push(`steps.${name}.after is ignored for built-in steps`);
        }
        if (cfg.enforcement !== undefined) {
          warnings.push(`steps.${name}.enforcement is ignored for built-in steps`);
        }

        // Disabling a gating/structural built-in is not allowed.
        const def = stepDefs.get(name as StepName);
        if (cfg.disable === true && def) {
          if (def.enforcement === 'gating' || def.enforcement === 'structural') {
            return errVal(
              `Cannot disable ${def.enforcement} step: "${name}". Only advisory steps may be disabled.`,
            );
          }
        }
      }
    }
  }

  // complexity
  if (obj.complexity !== undefined) {
    if (!isPlainObject(obj.complexity)) {
      return errVal('complexity must be an object');
    }
    const cx = obj.complexity as Record<string, unknown>;
    const VALID_TIERS = new Set(['S', 'M', 'L']);
    if (cx.default_tier !== undefined && !VALID_TIERS.has(cx.default_tier as string)) {
      return errVal('complexity.default_tier must be S|M|L');
    }
  }

  return { ok: true, config: obj as HarnessConfig, warnings };
}

function validateEffortAndModelBag(raw: unknown, path: string): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: `${path} must be an object` };
  }
  const obj = raw as Record<string, unknown>;
  // defaults/phases accept the same knobs as steps minus skill/disable/hooks/after.
  // (review is not user-configurable — it's fixed per step in resolved-config.ts)
  const allowed = new Set(['model', 'effort', 'max_retries', 'by_tier']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: 'validation_error',
        message: `Unknown key in ${path}: "${k}"`,
      };
    }
  }
  if (obj.effort !== undefined && !VALID_EFFORTS.has(obj.effort as EffortLevel)) {
    return {
      type: 'validation_error',
      message: `${path}.effort must be low|medium|high|xhigh|max`,
    };
  }
  if (obj.max_retries !== undefined && typeof obj.max_retries !== 'number') {
    return { type: 'validation_error', message: `${path}.max_retries must be a number` };
  }
  if (obj.model !== undefined && typeof obj.model !== 'string') {
    return { type: 'validation_error', message: `${path}.model must be a string` };
  }
  if (obj.by_tier !== undefined) {
    return validateByTier(obj.by_tier, `${path}.by_tier`);
  }
  return null;
}

function validateByTier(raw: unknown, path: string): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: `${path} must be an object` };
  }
  const obj = raw as Record<string, unknown>;
  const VALID_TIERS = new Set(['S', 'M', 'L']);
  for (const [tier, value] of Object.entries(obj)) {
    if (!VALID_TIERS.has(tier)) {
      return {
        type: 'validation_error',
        message: `${path}.${tier} — tier must be S, M, or L`,
      };
    }
    if (!isPlainObject(value)) {
      return {
        type: 'validation_error',
        message: `${path}.${tier} must be an object`,
      };
    }
    const tierCfg = value as Record<string, unknown>;
    const allowed = new Set(['model', 'effort', 'max_retries']);
    for (const k of Object.keys(tierCfg)) {
      if (!allowed.has(k)) {
        return {
          type: 'validation_error',
          message: `Unknown key in ${path}.${tier}: "${k}"`,
        };
      }
    }
    if (tierCfg.effort !== undefined && !VALID_EFFORTS.has(tierCfg.effort as EffortLevel)) {
      return {
        type: 'validation_error',
        message: `${path}.${tier}.effort must be low|medium|high|xhigh|max`,
      };
    }
    if (tierCfg.max_retries !== undefined && typeof tierCfg.max_retries !== 'number') {
      return {
        type: 'validation_error',
        message: `${path}.${tier}.max_retries must be a number`,
      };
    }
    if (tierCfg.model !== undefined && typeof tierCfg.model !== 'string') {
      return {
        type: 'validation_error',
        message: `${path}.${tier}.model must be a string`,
      };
    }
  }
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function errVal(message: string): ConfigResult {
  return { ok: false, error: { type: 'validation_error', message } };
}

export function satisfiesVersion(installed: string, constraint: string): boolean {
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

// ────────────────────────────────────────────────────────────────────────────
// Legacy adapters — some callers still read the old-shape fields
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the list of disabled step names from the new schema.
 */
export function disabledStepNames(config: HarnessConfig): StepName[] {
  if (!config.steps) return [];
  return Object.entries(config.steps)
    .filter(([, v]) => v?.disable === true)
    .map(([k]) => k as StepName);
}

/**
 * Extract the list of custom step entries from the new schema, in the shape
 * buildStepRegistry expects.
 */
export function customStepEntries(config: HarnessConfig): Array<{
  name: string;
  after: string;
  skill: string;
  enforcement: EnforcementLevel;
}> {
  if (!config.steps) return [];
  const builtIn = new Set(ALL_STEPS.map((s) => s.name as string));
  const out: Array<{ name: string; after: string; skill: string; enforcement: EnforcementLevel }> = [];
  for (const [name, cfg] of Object.entries(config.steps)) {
    if (builtIn.has(name)) continue;
    if (!cfg?.after || !cfg?.skill) continue;
    out.push({
      name,
      after: cfg.after,
      skill: cfg.skill,
      enforcement: (cfg.enforcement ?? 'advisory') as EnforcementLevel,
    });
  }
  return out;
}
