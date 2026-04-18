import { execFile as execFileCb } from 'child_process';

/**
 * Send a desktop notification. Falls back to terminal bell if
 * the platform notification command is unavailable.
 */
export async function sendNotification(title: string, message: string): Promise<void> {
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      await exec('osascript', ['-e', `display notification "${message}" with title "${title}"`]);
    } else {
      // Linux and other platforms: try notify-send
      await exec('notify-send', [title, message]);
    }
  } catch {
    // Fallback: terminal bell
    process.stderr.write('\x07');
  }
}

function exec(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFileCb(cmd, args, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
