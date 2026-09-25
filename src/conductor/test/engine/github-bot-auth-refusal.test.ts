import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyGhAuthRefusal,
  classifyGitPushAuthRefusal,
  GithubBotAuthRefusalError,
  type GithubBotAuthRefusalReason,
} from '../../src/engine/github-bot-auth-refusal.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/github-bot-auth/${name}`, import.meta.url), 'utf8');
}

function commandFailure(stderr: string, code: number | string = 1): Error & { code: number | string; stderr: string } {
  return Object.assign(new Error('Command failed'), { code, stderr });
}

describe('classifyGhAuthRefusal', () => {
  it.each([
    'gh-http-401-bad-credentials.txt',
    'gh-http-403-personal-access-token.txt',
  ])('recognizes the verbatim authenticated gh refusal fixture %s', (name) => {
    expect(classifyGhAuthRefusal(commandFailure(fixture(name)))).toBe('auth-refused');
  });

  it.each([
    commandFailure(fixture('gh-http-403-secondary-rate-limit.txt')),
    commandFailure('request timed out', 'ETIMEDOUT'),
    commandFailure('gh: Not Found (HTTP 404)'),
    commandFailure('HTTP 401'),
  ])('does not classify non-auth or context-free failures', (error) => {
    expect(classifyGhAuthRefusal(error)).toBeNull();
  });
});

describe('classifyGitPushAuthRefusal', () => {
  it.each([
    'git-push-authentication-failed.txt',
    'git-push-permission-denied.txt',
  ])('recognizes the verbatim authenticated git push refusal fixture %s', (name) => {
    expect(classifyGitPushAuthRefusal(commandFailure(fixture(name)))).toBe('auth-refused');
  });

  it.each([
    'git-push-non-fast-forward.txt',
    'git-push-stale-lease.txt',
    'git-push-network-error.txt',
  ])('does not classify non-auth git push failure %s', (name) => {
    expect(classifyGitPushAuthRefusal(commandFailure(fixture(name)))).toBeNull();
  });
});

describe('GithubBotAuthRefusalError', () => {
  it.each<GithubBotAuthRefusalReason>([
    'token-unavailable',
    'auth-refused',
    'unsupported-remote-transport',
  ])('has a closed safe reason for %s', (reason) => {
    const rawOutput = 'raw command output sentinel-token';
    const token = 'sentinel-token';
    const tokenFile = '/private/token-file';
    const error = new GithubBotAuthRefusalError(reason);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GithubBotAuthRefusalError');
    expect(error.reason).toBe(reason);
    expect(error.message).toBe('GitHub bot credential is unavailable for this operation.');
    expect(error.message).not.toContain(rawOutput);
    expect(error.message).not.toContain(token);
    expect(error.message).not.toContain(tokenFile);
  });
});
