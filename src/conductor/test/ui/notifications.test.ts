import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendNotification } from '../../src/ui/notifications.js';
import { execFile as execFileCb } from 'child_process';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFileCb);

describe('ui/notifications', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('sendNotification uses notify-send on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    // Mock execFile to succeed
    mockedExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(null, '', '');
      return undefined as any;
    });

    await sendNotification('Conductor', 'Step completed: brainstorm');

    expect(mockedExecFile).toHaveBeenCalledWith(
      'notify-send',
      ['Conductor', 'Step completed: brainstorm'],
      expect.any(Function),
    );
  });

  it('sendNotification falls back to terminal bell when notify-send unavailable', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    // Mock execFile to fail (notify-send not found)
    mockedExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(new Error('ENOENT'), '', '');
      return undefined as any;
    });

    const writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await sendNotification('Conductor', 'Step completed: brainstorm');

    expect(writeSpy).toHaveBeenCalledWith('\x07');
    writeSpy.mockRestore();
  });

  it('sendNotification uses osascript on macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    mockedExecFile.mockImplementation((_cmd: any, _args: any, cb: any) => {
      cb(null, '', '');
      return undefined as any;
    });

    await sendNotification('Conductor', 'Pipeline complete!');

    expect(mockedExecFile).toHaveBeenCalledWith(
      'osascript',
      ['-e', 'display notification "Pipeline complete!" with title "Conductor"'],
      expect.any(Function),
    );
  });
});
