import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { PI_FAILURE_SIGNATURES, PI_QUOTA_VOCABULARY_RE, parsePiJsonl, PiProvider } from '../../src/execution/pi-provider.js';
import { dispatchGitGuard } from '../fixtures/dispatch-git-guard.js';

vi.mock('execa', () => ({ execa: vi.fn() }));

const fixture = (name: string) => readFile(new URL(`../fixtures/pi/${name}`, import.meta.url), 'utf8');
const captures = {
  'pi-1.0.0-e1-no-api-key.stderr.txt': 'No API key found for deepseek.',
  'pi-1.0.0-e2-invalid-key-deepseek.jsonl': '401: {"message":"Authentication Fails, Your api key: ****0000 is invalid (request_id: 72ea5ff9-8912-4cdf-ab67-9dfd24e4af24)","type":"authentication_error","param":null,"code":"invalid_request_error"}',
  'pi-1.0.0-e3-invalid-key-openrouter.jsonl': '401: {"message":"User not found.","code":401}',
  'pi-1.0.0-e4-invalid-key-anthropic.jsonl': '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CgUU8ag6NK3M6kEMhoWvU"}',
  'pi-1.0.0-e5-oauth-refresh-failed.jsonl': 'OAuth refresh failed for anthropic: Anthropic token refresh request failed. url=https://platform.claude.com/v1/oauth/token; details=Error: HTTP request failed. status=400; url=https://platform.claude.com/v1/oauth/token; body={"error": "invalid_grant", "error_description": "Refresh token not found or invalid"}; stack=Error: HTTP request failed.',
  'pi-1.0.0-e6-rate-limit.jsonl': '429: {"message":"Rate limit reached for requests","type":"requests","param":null,"code":"rate_limit_exceeded"}',
  'pi-1.0.0-e7-usage-exhausted.jsonl': '429: {"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}',
  'pi-1.0.0-e8-rate-limit-anthropic.jsonl': '429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}',
  'pi-1.0.0-e9-server-error.jsonl': '500: {"message":"The server had an error while processing your request.","type":"server_error","param":null,"code":null}',
} as const;

describe('Pi 1.0.0 failure captures', () => {
  it('keeps every capture and the anchored, multiline signature table', async () => {
    const texts = await Promise.all(Object.keys(captures).map(fixture));
    expect(texts).toHaveLength(Object.keys(captures).length);
    for (const [name, evidence] of Object.entries(captures)) {
      const text = await fixture(name);
      const captured = name.endsWith('.stderr.txt') ? text : parsePiJsonl(text).terminalAssistantErrorMessage;
      expect(captured?.startsWith(evidence)).toBe(true);
    }
    const classified = [
      ...texts.map((text, index) => index === 0 ? text : parsePiJsonl(text).terminalAssistantErrorMessage ?? ''),
      parsePiJsonl(await readFile(new URL('../fixtures/pi-error-stop-stream.jsonl', import.meta.url), 'utf8')).terminalAssistantErrorMessage ?? '',
      // print-mode's stderr for agent-session.js's unresolved-OAuth throw (ADR D1 source row; no E-row capture).
      await fixture('pi-1.0.0-auth-failed-unresolved-oauth.stderr.txt'),
    ];
    for (const signature of PI_FAILURE_SIGNATURES) {
      expect(classified.some((text) => signature.pattern.test(text))).toBe(true);
      expect(signature.pattern.flags).toContain('m');
      expect(signature.pattern.flags).not.toContain('i');
      expect(signature.pattern.source.startsWith('^')).toBe(true);
    }
    expect(classified.some((text) => PI_QUOTA_VOCABULARY_RE.test(text))).toBe(true);
  });

  it('replays every JSONL stream only through its injected subprocess', async () => {
    const streams = Object.keys(captures).filter((name) => name.endsWith('.jsonl'));
    const spawn = vi.fn(async (_file: string, _args: readonly string[], options: { input?: string }) => ({
      stdout: await fixture(options.input!), stderr: '', exitCode: 0,
    }));
    const provider = new PiProvider(dispatchGitGuard, 'pi', spawn as never, {
      stat: async () => ({ isFile: () => true, isDirectory: () => false }), access: async () => {},
      env: {}, homeDir: () => '/home/test', cwd: () => '/workspace',
    });
    for (const name of streams) {
      await provider.invoke({ prompt: name, sessionId: 's', resume: false });
    }
    expect(spawn).toHaveBeenCalledTimes(streams.length);
    expect(vi.mocked(execa)).not.toHaveBeenCalled();
  });
});
