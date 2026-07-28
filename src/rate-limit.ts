import type { NextFunction, Request, Response } from "express";
import type { RateLimitSnapshot } from "./types.js";

type Entry = { timestamps: number[]; totalUploads: number; lastSeenAt: number };

export class UploadRateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    readonly limit = 10,
    readonly windowMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  middleware = (request: Request, response: Response, next: NextFunction): void => {
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    const current = this.now();
    const entry = this.entries.get(ip) ?? { timestamps: [], totalUploads: 0, lastSeenAt: current };
    entry.timestamps = entry.timestamps.filter((timestamp) => timestamp > current - this.windowMs);

    const resetAt = (entry.timestamps[0] ?? current) + this.windowMs;
    response.setHeader("RateLimit-Limit", this.limit);
    response.setHeader("RateLimit-Remaining", Math.max(0, this.limit - entry.timestamps.length));
    response.setHeader("RateLimit-Reset", Math.ceil(resetAt / 1000));

    if (entry.timestamps.length >= this.limit) {
      entry.lastSeenAt = current;
      this.entries.set(ip, entry);
      response.setHeader("Retry-After", Math.max(1, Math.ceil((resetAt - current) / 1000)));
      response.status(429).json({ error: "Upload limit reached. Try again after the five-minute window resets." });
      return;
    }

    entry.timestamps.push(current);
    entry.totalUploads += 1;
    entry.lastSeenAt = current;
    this.entries.set(ip, entry);
    response.setHeader("RateLimit-Remaining", this.limit - entry.timestamps.length);
    next();
  };

  snapshots(): RateLimitSnapshot[] {
    const current = this.now();
    return [...this.entries.entries()]
      .map(([ip, entry]) => {
        const active = entry.timestamps.filter((timestamp) => timestamp > current - this.windowMs);
        return {
          ip,
          count: active.length,
          remaining: Math.max(0, this.limit - active.length),
          resetAt: new Date((active[0] ?? current) + this.windowMs).toISOString(),
          totalUploads: entry.totalUploads,
          lastSeenAt: new Date(entry.lastSeenAt).toISOString(),
        };
      })
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }
}
