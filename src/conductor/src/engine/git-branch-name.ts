/** Mirrors the reject conditions of `git check-ref-format --branch` without a subprocess. */
export function isValidGitBranchName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value !== '@' && !value.startsWith('-')
    && !value.startsWith('/') && !value.endsWith('/') && !value.endsWith('.')
    && !value.includes('..') && !value.includes('@{') && !value.includes('//')
    && !/[\x00-\x20\x7f ~^:?*[\\]/.test(value)
    && value.split('/').every((component) => component.length > 0 && !component.startsWith('.') && !component.endsWith('.lock'));
}
