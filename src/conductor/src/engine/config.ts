import { readFile, rename, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, isAbsolute, resolve as resolvePath, dirname } from 'path';
import { load as loadYaml } from 'js-yaml';
import type {
  HarnessConfig,
  StepConfig,
  EffortLevel,
  MarkdownViewerConfig,
} from '../types/config.js';
import type { StepName, EnforcementLevel } from '../types/index.js';
import { ALL_STEPS } from './steps.js';
import { readUserConfig } from './user-config.js';
import { VALID_MARKDOWN_VIEWER_MODES } from './md-viewer-presets.js';
import { validateWhenSyntax } from './when-expression.js';

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

export const PROJECT_CONFIG_DIR = '.ai-conductor';
export const PROJECT_CONFIG_FILE = 'config.yml';
export const LEGACY_PROJECT_CONFIG_DIR = '.harness';

export function projectConfigPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE);
}

export function legacyProjectConfigPath(projectRoot: string): string {
  return join(projectRoot, LEGACY_PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILE);
}

/**
 * One-shot, idempotent relocation of legacy .harness/config.yml into
 * .ai-conductor/config.yml. Only moves the file when the new location is
 * absent and the legacy file is readable; on any failure it leaves both
 * files alone so callers can surface a clean error.
 */
export async function migrateLegacyProjectConfig(projectRoot: string): Promise<boolean> {
  const newPath = projectConfigPath(projectRoot);
  const oldPath = legacyProjectConfigPath(projectRoot);
  if (existsSync(newPath) || !existsSync(oldPath)) return false;
  try {
    await mkdir(dirname(newPath), { recursive: true });
    await rename(oldPath, newPath);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig(
  projectRoot: string,
  harnessVersion?: string,
): Promise<ConfigResult> {
  // One-shot: relocate legacy .harness/config.yml into .ai-conductor/ on first
  // call. Idempotent — no-op if the new location already exists or legacy is
  // absent.
  await migrateLegacyProjectConfig(projectRoot);

  const configPath = projectConfigPath(projectRoot);

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
    'conductor',
    'markdown_viewer',
    'assess',
    'acceptance_spec_globs',
    // Plugin selections (ADR-015/016)
    'llm_provider',
    'ui_renderer',
    'memory_provider',
    // Observability
    'otel',
  ]);
  for (const key of Object.keys(obj)) {
    if (!knownTopLevelKeys.has(key)) {
      return errVal(`Unknown top-level key: "${key}"`);
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
        return errVal(`Unknown phase: "${phase}"`);
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
    // Collect all custom-step names up-front so a custom can legally point
    // `after` at a sibling custom (chain ordering). Validation still rejects
    // references that don't resolve to either built-in or declared custom.
    const customStepNames = new Set<string>();
    for (const [n, v] of Object.entries(obj.steps as Record<string, unknown>)) {
      if (!builtInNames.has(n as StepName) && isPlainObject(v)) {
        customStepNames.add(n);
      }
    }

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
        'when',
        'parallel',
      ]);
      for (const k of Object.keys(cfg)) {
        if (!knownStepKeys.has(k)) {
          return errVal(`Unknown key in steps.${name}: "${k}"`);
        }
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

      // Validate when: syntax at config-load time (T8 / T13)
      if (cfg.when !== undefined) {
        if (typeof cfg.when !== 'string') {
          return errVal(`steps.${name}.when must be a string expression`);
        }
        const syntaxErr = validateWhenSyntax(cfg.when);
        if (syntaxErr) {
          return errVal(`steps.${name}.when: ${syntaxErr}`);
        }
      }

      // Validate parallel: structure (T13)
      if (cfg.parallel !== undefined) {
        if (!Array.isArray(cfg.parallel)) {
          return errVal(`steps.${name}.parallel must be an array`);
        }
        if (cfg.skill !== undefined) {
          return errVal(
            `steps.${name}: "skill" and "parallel" are mutually exclusive`,
          );
        }
        const branchNames = new Set<string>();
        for (let bi = 0; bi < (cfg.parallel as unknown[]).length; bi++) {
          const branch = (cfg.parallel as unknown[])[bi];
          if (!isPlainObject(branch)) {
            return errVal(`steps.${name}.parallel[${bi}] must be an object`);
          }
          const b = branch as Record<string, unknown>;
          const knownBranchKeys = new Set(['name', 'skill', 'model', 'effort', 'advisory']);
          for (const bk of Object.keys(b)) {
            if (!knownBranchKeys.has(bk)) {
              return errVal(`Unknown key in steps.${name}.parallel[${bi}]: "${bk}"`);
            }
          }
          if (typeof b.name !== 'string' || !b.name) {
            return errVal(`steps.${name}.parallel[${bi}].name must be a non-empty string`);
          }
          if (branchNames.has(b.name)) {
            return errVal(
              `steps.${name}.parallel has duplicate branch name: "${b.name}"`,
            );
          }
          branchNames.add(b.name);
          if (b.skill !== undefined && typeof b.skill !== 'string') {
            return errVal(`steps.${name}.parallel[${bi}].skill must be a string`);
          }
          if (b.model !== undefined && typeof b.model !== 'string') {
            return errVal(`steps.${name}.parallel[${bi}].model must be a string`);
          }
          if (b.effort !== undefined && !VALID_EFFORTS.has(b.effort as EffortLevel)) {
            return errVal(`steps.${name}.parallel[${bi}].effort must be low|medium|high|xhigh|max`);
          }
          if (b.advisory !== undefined && typeof b.advisory !== 'boolean') {
            return errVal(`steps.${name}.parallel[${bi}].advisory must be a boolean`);
          }
        }
      }

      const isCustom = !builtInNames.has(name as StepName);

      if (isCustom) {
        // Custom steps need both `after` and `skill`.
        if (typeof cfg.after !== 'string') {
          return errVal(`Custom step "${name}" requires 'after: <existing-step>'`);
        }
        const afterTarget = cfg.after as string;
        const isBuiltIn = builtInNames.has(afterTarget as StepName);
        const isSiblingCustom = customStepNames.has(afterTarget) && afterTarget !== name;
        if (!isBuiltIn && !isSiblingCustom) {
          return errVal(
            `Custom step "${name}" references unknown after target: "${afterTarget}"`,
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
        // Built-in step: 'after' / 'enforcement' are not permitted — they're
        // built-in-step-only fields. Fail fast so the user sees the bad key.
        if (cfg.after !== undefined) {
          return errVal(`steps.${name}.after is not valid for built-in steps`);
        }
        if (cfg.enforcement !== undefined) {
          return errVal(`steps.${name}.enforcement is not valid for built-in steps`);
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

  // conductor (user-level global state)
  if (obj.conductor !== undefined) {
    const err = validateConductorBlock(obj.conductor);
    if (err) return { ok: false, error: err };
  }

  // markdown_viewer
  if (obj.markdown_viewer !== undefined) {
    const err = validateMarkdownViewerBlock(obj.markdown_viewer);
    if (err) return { ok: false, error: err };
  }

  // assess
  if (obj.assess !== undefined) {
    const err = validateAssessBlock(obj.assess);
    if (err) return { ok: false, error: err };
  }

  // acceptance_spec_globs — list of extra globs for the acceptance_specs gate.
  if (obj.acceptance_spec_globs !== undefined) {
    if (!Array.isArray(obj.acceptance_spec_globs)) {
      return errVal('acceptance_spec_globs must be an array of strings');
    }
    if (!obj.acceptance_spec_globs.every((g) => typeof g === 'string')) {
      return errVal('acceptance_spec_globs must contain only strings');
    }
  }

  return { ok: true, config: obj as HarnessConfig, warnings };
}

function validateConductorBlock(raw: unknown): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'conductor must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['update_channel', 'auto_check', 'current_version', 'last_checked_at']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: 'validation_error',
        message: `Unknown key in conductor: "${k}"`,
      };
    }
  }
  if (
    obj.update_channel !== undefined &&
    obj.update_channel !== 'tagged' &&
    obj.update_channel !== 'main'
  ) {
    return {
      type: 'validation_error',
      message: 'conductor.update_channel must be "tagged" or "main"',
    };
  }
  if (obj.auto_check !== undefined && typeof obj.auto_check !== 'boolean') {
    return { type: 'validation_error', message: 'conductor.auto_check must be a boolean' };
  }
  if (obj.current_version !== undefined && typeof obj.current_version !== 'string') {
    return { type: 'validation_error', message: 'conductor.current_version must be a string' };
  }
  if (obj.last_checked_at !== undefined && typeof obj.last_checked_at !== 'string') {
    return { type: 'validation_error', message: 'conductor.last_checked_at must be a string' };
  }
  return null;
}

function validateAssessBlock(raw: unknown): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'assess must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['stale_after_days', 'stale_after_commits']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return { type: 'validation_error', message: `Unknown key in assess: "${k}"` };
    }
  }
  for (const k of ['stale_after_days', 'stale_after_commits']) {
    const v = obj[k];
    if (v !== undefined) {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        return {
          type: 'validation_error',
          message: `assess.${k} must be a non-negative number`,
        };
      }
    }
  }
  return null;
}

function validateMarkdownViewerBlock(raw: unknown): ConfigError | null {
  if (!isPlainObject(raw)) {
    return { type: 'validation_error', message: 'markdown_viewer must be an object' };
  }
  const obj = raw as Record<string, unknown>;
  const allowed = new Set(['preset', 'command', 'args', 'mode']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      return {
        type: 'validation_error',
        message: `Unknown key in markdown_viewer: "${k}"`,
      };
    }
  }
  if (obj.preset !== undefined && typeof obj.preset !== 'string') {
    return { type: 'validation_error', message: 'markdown_viewer.preset must be a string' };
  }
  if (obj.command !== undefined && typeof obj.command !== 'string') {
    return { type: 'validation_error', message: 'markdown_viewer.command must be a string' };
  }
  if (obj.args !== undefined) {
    if (!Array.isArray(obj.args) || obj.args.some((a) => typeof a !== 'string')) {
      return {
        type: 'validation_error',
        message: 'markdown_viewer.args must be an array of strings',
      };
    }
    if (!obj.args.includes('{file}')) {
      return {
        type: 'validation_error',
        message: 'markdown_viewer.args must include "{file}" placeholder',
      };
    }
  }
  if (obj.mode !== undefined && !VALID_MARKDOWN_VIEWER_MODES.has(obj.mode as MarkdownViewerConfig['mode'])) {
    return {
      type: 'validation_error',
      message: 'markdown_viewer.mode must be inline|blocking|external',
    };
  }
  return null;
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

/**
 * Deep-merge project config on top of user config. Objects merge key-by-key;
 * scalars and arrays from `project` replace `user`.
 */
export function mergeConfigs(user: HarnessConfig, project: HarnessConfig): HarnessConfig {
  return deepMerge(user as Record<string, unknown>, project as Record<string, unknown>) as HarnessConfig;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, bv] of Object.entries(b)) {
    const av = out[k];
    if (isPlainObject(av) && isPlainObject(bv)) {
      out[k] = deepMerge(av, bv);
    } else {
      out[k] = bv;
    }
  }
  return out;
}

/**
 * Load project config (.ai-conductor/config.yml), merge user config
 * (~/.ai-conductor/config.yml) underneath, validate the result. Returns the
 * merged + validated config. User-config parse errors become warnings, not
 * hard failures, so a broken user file never blocks an otherwise-healthy
 * project.
 */
export async function loadMergedConfig(
  projectRoot: string,
  harnessVersion?: string,
): Promise<ConfigResult> {
  const projectResult = await loadConfig(projectRoot, harnessVersion);
  if (!projectResult.ok) return projectResult;

  const userResult = await readUserConfig();
  if (userResult.parseError) {
    return {
      ok: false,
      error: {
        type: 'parse_error',
        message: `user config parse error: ${userResult.parseError}`,
      },
    };
  }

  const merged = mergeConfigs(userResult.config, projectResult.config);
  const validated = validateConfig(merged, projectRoot);
  if (!validated.ok) return validated;

  return {
    ok: true,
    config: validated.config,
    warnings: [...projectResult.warnings, ...validated.warnings],
  };
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
