type Stamp = number;

export class PerUserTTLRateLimiter {
  private ttlMs: number;
  private last: Map<string, Stamp> = new Map();

  constructor(ttlSeconds: number) {
    this.ttlMs = ttlSeconds * 1000;
  }

  public checkAndSet(upn: string): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    const prev = this.last.get(upn);
    if (prev && now - prev < this.ttlMs) {
      return { allowed: false, retryAfterMs: this.ttlMs - (now - prev) };
    }
    this.last.set(upn, now);
    return { allowed: true, retryAfterMs: 0 };
  }
}
