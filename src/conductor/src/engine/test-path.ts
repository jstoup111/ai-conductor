/** Shared path conventions for executable tests and their support files. */
export function isTestFilePath(path: string): boolean {
  return /\.(?:test|spec)\.[^/]+$/i.test(path)
    || (isTestSupportPath(path) && /(?:_test|_spec)\.[^/]+$/i.test(path));
}

/** Test trees may also hold helpers and fixtures that are not selectors. */
export function isTestSupportPath(path: string): boolean {
  return /(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|$)/i.test(path);
}

export function isTestPath(path: string): boolean {
  return isTestFilePath(path) || isTestSupportPath(path);
}
