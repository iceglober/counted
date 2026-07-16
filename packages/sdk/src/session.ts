const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

function generateSessionId(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}.${random}`;
}

/**
 * Per-instance session state. Each Analytics instance owns its own Session so
 * two instances never interleave events under one sessionId or clobber each
 * other's timeout (previously these were module globals).
 */
export class Session {
  private sessionId: string | null = null;
  private lastActivity = 0;
  private timeoutMs = DEFAULT_SESSION_TIMEOUT_MS;

  constructor(opts: { sessionId?: string; sessionTimeout?: number } = {}) {
    if (opts.sessionId) {
      this.sessionId = opts.sessionId;
      this.lastActivity = Date.now();
    }
    if (opts.sessionTimeout !== undefined) {
      this.timeoutMs = opts.sessionTimeout;
    }
  }

  /** Returns the current session id, rolling it over after the idle timeout. */
  getSessionId(): string {
    const now = Date.now();

    if (!this.sessionId || (this.timeoutMs > 0 && now - this.lastActivity > this.timeoutMs)) {
      this.sessionId = generateSessionId();
    }

    this.lastActivity = now;
    return this.sessionId;
  }
}
