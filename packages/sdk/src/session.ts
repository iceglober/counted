const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;

let sessionId: string | null = null;
let lastActivity = 0;
let timeoutMs = DEFAULT_SESSION_TIMEOUT_MS;

function generateSessionId(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}.${random}`;
}

export function configureSession(opts: { sessionId?: string; sessionTimeout?: number }) {
  if (opts.sessionId) {
    sessionId = opts.sessionId;
    lastActivity = Date.now();
  }
  if (opts.sessionTimeout !== undefined) {
    timeoutMs = opts.sessionTimeout;
  }
}

export function getSessionId(): string {
  const now = Date.now();

  if (!sessionId || (timeoutMs > 0 && now - lastActivity > timeoutMs)) {
    sessionId = generateSessionId();
  }

  lastActivity = now;
  return sessionId;
}
