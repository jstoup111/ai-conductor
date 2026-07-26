export const SHIPPED_RECORD_REQUIRED_CONTEXT = 'shipped-record';
export const SHIPMENT_PROTECTION_RULESET_ID = '15933604';

export interface RulesetRule {
  type: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A complete GitHub ruleset response, kept opaque except for its rules. */
export interface RulesetSnapshot {
  id: string | number;
  name: string;
  target: string;
  enforcement: string;
  conditions: unknown;
  bypass_actors: unknown;
  rules: RulesetRule[];
  [key: string]: unknown;
}

export interface ShipmentProtectionPlan {
  changed: boolean;
  before: RulesetSnapshot;
  after: RulesetSnapshot;
}

export interface RulesetUpdatePayload {
  name: string;
  target: string;
  enforcement: string;
  conditions: unknown;
  bypass_actors: unknown;
  rules: RulesetRule[];
}

export interface RulesetClient {
  readRuleset: (id: string) => Promise<RulesetSnapshot>;
  updateRuleset: (id: string, payload: RulesetUpdatePayload) => Promise<void>;
}

export interface ShipmentProtectionRequest {
  mode: 'dry-run' | 'apply';
  contextObserved: boolean;
  rulesetId?: string;
}

export type ShipmentProtectionResult =
  | { kind: 'dry-run'; plan: ShipmentProtectionPlan }
  | { kind: 'applied'; plan: ShipmentProtectionPlan; after: RulesetSnapshot }
  | {
      kind: 'refused';
      code: 'shipped-record-context-unobserved' | 'ruleset-drift';
    };

/**
 * Produces the one permitted ruleset change without mutating the observed
 * snapshot: append the stable required context, preserving every other rule
 * and all conditions and bypass actors byte-for-byte.
 */
export function planShipmentProtection(snapshot: RulesetSnapshot): ShipmentProtectionPlan {
  const before = structuredClone(snapshot) as RulesetSnapshot;
  const after = structuredClone(snapshot) as RulesetSnapshot;
  const statusRuleIndexes = after.rules
    .map((rule, index) => (rule.type === 'required_status_checks' ? index : -1))
    .filter((index) => index !== -1);
  if (statusRuleIndexes.length > 1) {
    throw new Error('ruleset has multiple required_status_checks rules');
  }

  if (statusRuleIndexes.length === 0) {
    after.rules.push({
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [{ context: SHIPPED_RECORD_REQUIRED_CONTEXT }],
      },
    });
    return { changed: true, before, after };
  }

  const rule = after.rules[statusRuleIndexes[0]];
  const parameters = rule.parameters;
  const checks = parameters?.required_status_checks;
  if (!Array.isArray(checks) || !checks.every(isStatusCheck)) {
    throw new Error('ruleset required_status_checks parameters are malformed');
  }
  if (checks.some((check) => check.context === SHIPPED_RECORD_REQUIRED_CONTEXT)) {
    return { changed: false, before, after };
  }

  rule.parameters = {
    ...parameters,
    required_status_checks: [...checks, { context: SHIPPED_RECORD_REQUIRED_CONTEXT }],
  };
  return { changed: true, before, after };
}

/**
 * Reads the complete ruleset before planning. Apply is deliberately unavailable
 * until the bootstrap Action context has been observed by the caller.
 */
export async function configureShipmentProtection(
  request: ShipmentProtectionRequest,
  client: RulesetClient,
): Promise<ShipmentProtectionResult> {
  if (request.mode === 'apply' && !request.contextObserved) {
    return { kind: 'refused', code: 'shipped-record-context-unobserved' };
  }

  const rulesetId = request.rulesetId ?? SHIPMENT_PROTECTION_RULESET_ID;
  const plan = planShipmentProtection(await client.readRuleset(rulesetId));
  if (request.mode === 'dry-run') return { kind: 'dry-run', plan };
  if (!plan.changed) return { kind: 'applied', plan, after: plan.after };

  await client.updateRuleset(rulesetId, toUpdatePayload(plan.after));
  const after = await client.readRuleset(rulesetId);
  if (!sameJson(toUpdatePayload(after), toUpdatePayload(plan.after))) {
    return { kind: 'refused', code: 'ruleset-drift' };
  }
  return { kind: 'applied', plan, after };
}

function toUpdatePayload(snapshot: RulesetSnapshot): RulesetUpdatePayload {
  return {
    name: snapshot.name,
    target: snapshot.target,
    enforcement: snapshot.enforcement,
    conditions: structuredClone(snapshot.conditions),
    bypass_actors: structuredClone(snapshot.bypass_actors),
    rules: structuredClone(snapshot.rules),
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isStatusCheck(value: unknown): value is { context: string; [key: string]: unknown } {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { context?: unknown }).context === 'string';
}
