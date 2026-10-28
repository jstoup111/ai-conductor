/** Gates accepted by `kickback-budget raise|reset --gate`. */
export const KICKBACK_BUDGET_GATES = ['build_review', 'prd_audit', 'architecture_review_as_built', 'restack'] as const;

export interface KickbackBudgetDispatch {
  kind: 'kickback-budget';
  action: 'inspect' | 'raise' | 'reset';
  feature: string;
  child?: string;
  gate?: string;
  by?: number;
  rationale?: string;
  format: 'human' | 'json';
}

/** Parse the explicit operator budget-recovery command without booting the pipeline. */
export function detectKickbackBudgetCommand(argv: string[]): KickbackBudgetDispatch | null {
  if (argv[2] !== 'kickback-budget' || !['inspect', 'raise', 'reset'].includes(argv[3] ?? '')) return null;
  const action = argv[3] as KickbackBudgetDispatch['action'];
  const values = new Map<string, string>();
  for (let i = 4; i < argv.length; i += 2) {
    const flag = argv[i]; const value = argv[i + 1];
    if (!flag || value === undefined || !['--feature', '--child', '--gate', '--by', '--rationale', '--format'].includes(flag) || values.has(flag)) return null;
    values.set(flag, value);
  }
  const feature = values.get('--feature');
  const format = values.get('--format') ?? 'human';
  if (!feature || feature.includes('/') || feature === '.' || feature === '..' || (format !== 'human' && format !== 'json')) return null;
  if (action === 'inspect') {
    if (values.size > (values.has('--child') ? 3 : 2) || values.has('--gate')) return null;
    const child = values.get('--child');
    return { kind: 'kickback-budget', action, feature, format, ...(child === undefined ? {} : { child }) };
  }
  const gate = values.get('--gate'); const rationale = values.get('--rationale');
  if (!gate || !rationale?.trim()) return null;
  if (action === 'raise') {
    const by = Number(values.get('--by'));
    if (!Number.isSafeInteger(by) || by <= 0) return null;
    const child = values.get('--child');
    return { kind: 'kickback-budget', action, feature, gate, by, rationale, format, ...(child === undefined ? {} : { child }) };
  }
  const child = values.get('--child');
  return !values.has('--by') ? {
    kind: 'kickback-budget', action, feature, gate, rationale, format,
    ...(child === undefined ? {} : { child }),
  } : null;
}
