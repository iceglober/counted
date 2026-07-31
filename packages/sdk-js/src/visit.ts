/**
 * The visit id.
 *
 * v1 called this a "session", which in that codebase meant three incompatible
 * things: the login session (which stored IP and user-agent — the two things
 * the marketing swears are never stored), this ephemeral grouping, and a
 * Stripe idempotency key. One word, three meanings, and code that moved
 * between them without noticing.
 *
 * A visit is **not an identity**. It expires after half an hour idle, it is
 * per-instance rather than global, and nothing derives a person from it.
 * Retention across days needs `identify()`, which is the customer's own id and
 * the only way one ever enters the system.
 */

const DEFAULT_IDLE_MS = 30 * 60 * 1000;

export type VisitOptions = {
  /** Resume an existing visit — a server handing one to a client, say. */
  readonly visitId?: string;
  /** Zero disables rollover, for a process that is one visit by definition. */
  readonly idleMs?: number;
  readonly now?: () => number;
  readonly random?: () => number;
};

/**
 * Per-instance, not module-global.
 *
 * Two clients in one process — a test suite, a monorepo dev server — must not
 * interleave events under one visit or clobber each other's timeout. v1's were
 * module globals and did exactly that.
 */
export class Visit {
  private id: string | null = null;
  private lastActivity = 0;
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(options: VisitOptions = {}) {
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    if (options.visitId !== undefined) {
      this.id = options.visitId;
      this.lastActivity = this.now();
    }
  }

  /** The current visit, rolling over once it has been idle too long. */
  current(): string {
    const now = this.now();
    if (this.id === null || (this.idleMs > 0 && now - this.lastActivity > this.idleMs)) {
      this.id = this.mint(now);
    }
    this.lastActivity = now;
    return this.id;
  }

  /**
   * Start a new visit deliberately.
   *
   * Called by `reset()` on sign-out: continuing to group a new person's events
   * under the previous visitor's id is the kind of thing that looks like a
   * privacy incident even when no identity was involved.
   */
  restart(): string {
    this.id = this.mint(this.now());
    this.lastActivity = this.now();
    return this.id;
  }

  private mint(now: number): string {
    // Seconds and a random suffix. Sortable enough to read in a log, and
    // carrying nothing about the device or the person.
    return `${Math.floor(now / 1000)}.${this.random().toString(36).slice(2, 10)}`;
  }
}
