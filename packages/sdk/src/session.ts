const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

let sessionId: string | null = null;
let lastActivity = 0;

function generateSessionId(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}.${random}`;
}

export function getSessionId(): string {
  const now = Date.now();

  if (!sessionId || now - lastActivity > SESSION_TIMEOUT_MS) {
    sessionId = generateSessionId();
  }

  lastActivity = now;
  return sessionId;
}
