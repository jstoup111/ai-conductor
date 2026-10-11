/**
 * The only inline commands remediation guidance may offer to an operator.
 * Keeping this union closed makes each rendered command independently
 * parseable by the CLI proof in remediation-commands.test.ts.
 */
export type RemediationCommand =
  | { readonly kind: 'inline-run'; readonly feature?: string }
  | { readonly kind: 'inline-reset'; readonly feature?: string }
  | { readonly kind: 'inline-status'; readonly feature?: string }
  | { readonly kind: 'inline-resume'; readonly feature?: string }
  | { readonly kind: 'inline-report'; readonly feature?: string }
  | { readonly kind: 'inline-diagnose'; readonly feature?: string }
  | { readonly kind: 'inline-fresh'; readonly feature?: string };

/** Commands rendered before inline argument parsing owns the invocation. */
export type PreGuardCommand =
  | { readonly kind: 'top-level-help' }
  | { readonly kind: 'compose' }
  | { readonly kind: 'daemon-start' };

/** Every command shape is exercised through the real inline CLI parser. */
export const REMEDIATION_COMMAND_FIXTURES: readonly RemediationCommand[] = Object.freeze([
  { kind: 'inline-run' },
  { kind: 'inline-run', feature: 'add login' },
  { kind: 'inline-reset' },
  { kind: 'inline-reset', feature: 'add login' },
  { kind: 'inline-status' },
  { kind: 'inline-status', feature: 'add login' },
  { kind: 'inline-resume' },
  { kind: 'inline-resume', feature: 'add login' },
  { kind: 'inline-report' },
  { kind: 'inline-report', feature: 'add login' },
  { kind: 'inline-diagnose' },
  { kind: 'inline-diagnose', feature: 'add login' },
  { kind: 'inline-fresh' },
  { kind: 'inline-fresh', feature: 'add login' },
]);

/** Every command shape dispatched before the inline guard. */
export const PRE_GUARD_COMMAND_FIXTURES: readonly PreGuardCommand[] = Object.freeze([
  { kind: 'top-level-help' },
  { kind: 'compose' },
  { kind: 'daemon-start' },
]);

/** Returns argv after the `ai-conductor` binary name. */
export function remediationArgv(command: RemediationCommand): string[] {
  const args = ['inline'];
  switch (command.kind) {
    case 'inline-run':
      break;
    case 'inline-reset':
      args.push('--reset');
      break;
    case 'inline-status':
      args.push('--status');
      break;
    case 'inline-resume':
      args.push('--resume');
      break;
    case 'inline-report':
      args.push('--report');
      break;
    case 'inline-diagnose':
      args.push('--diagnose');
      break;
    case 'inline-fresh':
      args.push('--fresh');
      break;
  }
  if (command.feature) args.push(command.feature);
  return args;
}

function shellQuote(token: string, force = false): string {
  return !force && /^[A-Za-z0-9_./:-]+$/.test(token)
    ? token
    : `"${token.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Formats an operator-facing remediation command from its tokenized form. */
export function formatRemediationCommand(command: RemediationCommand): string {
  const args = remediationArgv(command);
  return [
    'ai-conductor',
    ...args.map((arg, index) => shellQuote(arg, Boolean(command.feature) && index === args.length - 1)),
  ].join(' ');
}

/** Formats an operator-facing command handled before the inline guard. */
export function formatPreGuardCommand(command: PreGuardCommand | RemediationCommand): string {
  if (command.kind.startsWith('inline-')) return formatRemediationCommand(command);
  switch (command.kind) {
    case 'top-level-help':
      return 'ai-conductor --help';
    case 'compose':
      return 'ai-conductor compose';
    case 'daemon-start':
      return 'ai-conductor daemon start';
  }
}
