import { readFile, writeFile, rm, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';

const SESSION_FILE = 'conduct-session-id';
const MARKER_FILE = 'session-created';

export class SessionManager {
  private sessionId: string | null = null;
  private created = false;

  constructor(private pipelineDir: string) {}

  async getSessionId(): Promise<string> {
    if (this.sessionId) return this.sessionId;

    const filePath = join(this.pipelineDir, SESSION_FILE);
    try {
      const contents = await readFile(filePath, 'utf-8');
      const id = contents.trim();
      if (id) {
        this.sessionId = id;
        // Also check if marker exists on disk
        this.created = await this.fileExists(join(this.pipelineDir, MARKER_FILE));
        return id;
      }
    } catch {
      // File doesn't exist — create new
    }

    const id = uuidv4();
    this.sessionId = id;
    // Ensure .pipeline directory exists before writing (guards against mid-run wipe)
    await mkdir(this.pipelineDir, { recursive: true });
    await writeFile(filePath, id, 'utf-8');
    return id;
  }

  async resetSession(): Promise<string> {
    const id = uuidv4();
    this.sessionId = id;
    this.created = false;
    await writeFile(join(this.pipelineDir, SESSION_FILE), id, 'utf-8');
    try {
      await rm(join(this.pipelineDir, MARKER_FILE));
    } catch {
      // Marker may not exist
    }
    return id;
  }

  async markSessionCreated(): Promise<void> {
    this.created = true;
    await writeFile(join(this.pipelineDir, MARKER_FILE), '1', 'utf-8');
  }

  async isSessionCreated(): Promise<boolean> {
    if (this.created) return true;
    const exists = await this.fileExists(join(this.pipelineDir, MARKER_FILE));
    this.created = exists;
    return exists;
  }

  buildClaudeArgs(options: { interactive?: boolean }): string[] {
    const args: string[] = [];

    if (!this.sessionId) {
      throw new Error('Must call getSessionId() before buildClaudeArgs()');
    }

    if (this.created) {
      args.push('--resume', this.sessionId);
    } else {
      args.push('--session-id', this.sessionId);
    }

    if (!options.interactive) {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--permission-mode', 'default');
    }

    return args;
  }

  detectStaleSession(output: string): boolean {
    return /No conversation found/i.test(output);
  }

  detectRateLimit(output: string): boolean {
    return /rate limit|429|overloaded|usage limit/i.test(output);
  }

  getCooldownSeconds(callCount: number): number {
    const base = 60;
    if (callCount < 10) return base;
    if (callCount < 20) return base * 2;
    return base * 3;
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
