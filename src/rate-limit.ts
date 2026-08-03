import type { NextFunction, Request, Response } from "express";
import type { RateLimitSnapshot } from "./types.js";
import { AppDatabase } from "./database.js";

export class UploadRateLimiter {
  constructor(
    readonly limit = 10,
    readonly windowMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
    private readonly store = new AppDatabase(),
  ) {}

  middleware = (request: Request, response: Response, next: NextFunction): void => {
    const ip = request.ip || request.socket.remoteAddress || "unknown";
    const current = this.now();
    const result = this.store.consumeRateLimit(ip, this.limit, this.windowMs, current);
    response.setHeader("RateLimit-Limit", this.limit);
    response.setHeader("RateLimit-Remaining", Math.max(0, this.limit - result.count));
    response.setHeader("RateLimit-Reset", Math.ceil(result.resetAt / 1000));

    if (!result.allowed) {
      response.setHeader("Retry-After", Math.max(1, Math.ceil((result.resetAt - current) / 1000)));
      response
        .status(429)
        .json({ error: "Upload limit reached. Try again after the five-minute window resets." });
      return;
    }

    next();
  };

  snapshots(): RateLimitSnapshot[] {
    return this.store.rateLimitSnapshots(this.limit, this.windowMs, this.now());
  }
}
