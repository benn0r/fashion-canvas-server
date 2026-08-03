import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OutfitDebugInfo, RateLimitSnapshot, UploadHistoryEntry } from "./types.js";

export class AppDatabase {
  private readonly database: DatabaseSync;

  constructor(filename = process.env.DATABASE_PATH ?? "data/fashion-canvas.sqlite") {
    if (filename !== ":memory:")
      mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS rate_limit_events (
        id INTEGER PRIMARY KEY,
        ip TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rate_limit_events_ip_created
        ON rate_limit_events (ip, created_at_ms);
      CREATE TABLE IF NOT EXISTS rate_limit_clients (
        ip TEXT PRIMARY KEY,
        total_uploads INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS uploads (
        id INTEGER PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        ip TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        app_version TEXT NOT NULL,
        status TEXT NOT NULL,
        upload_bytes INTEGER,
        analysis_input_tokens INTEGER,
        analysis_output_tokens INTEGER,
        generation_input_tokens INTEGER,
        generation_output_tokens INTEGER,
        total_tokens INTEGER,
        estimated_price_usd REAL,
        price_is_calculated INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS uploads_created ON uploads (created_at_ms DESC);
    `);
    const uploadColumns = this.database.prepare("PRAGMA table_info(uploads)").all() as Array<{
      name: string;
    }>;
    if (!uploadColumns.some((column) => column.name === "upload_bytes"))
      this.database.exec("ALTER TABLE uploads ADD COLUMN upload_bytes INTEGER");
  }

  consumeRateLimit(ip: string, limit: number, windowMs: number, now: number) {
    const cutoff = now - windowMs;
    this.database.prepare("DELETE FROM rate_limit_events WHERE created_at_ms <= ?").run(cutoff);
    const row = this.database
      .prepare(
        "SELECT COUNT(*) AS count, MIN(created_at_ms) AS oldest FROM rate_limit_events WHERE ip = ? AND created_at_ms > ?",
      )
      .get(ip, cutoff) as { count: number; oldest: number | null };
    if (row.count >= limit)
      return { allowed: false, count: row.count, resetAt: (row.oldest ?? now) + windowMs };
    this.database
      .prepare("INSERT INTO rate_limit_events (ip, created_at_ms) VALUES (?, ?)")
      .run(ip, now);
    this.database
      .prepare(
        `INSERT INTO rate_limit_clients (ip, total_uploads, last_seen_at_ms) VALUES (?, 1, ?)
         ON CONFLICT(ip) DO UPDATE SET
           total_uploads = total_uploads + 1,
           last_seen_at_ms = excluded.last_seen_at_ms`,
      )
      .run(ip, now);
    return {
      allowed: true,
      count: row.count + 1,
      resetAt: (row.oldest ?? now) + windowMs,
    };
  }

  rateLimitSnapshots(limit: number, windowMs: number, now: number): RateLimitSnapshot[] {
    const cutoff = now - windowMs;
    return this.database
      .prepare(
        `SELECT events.ip, COUNT(*) AS count, MIN(events.created_at_ms) AS oldest,
                clients.last_seen_at_ms AS last_seen, clients.total_uploads AS total
         FROM rate_limit_events events
         JOIN rate_limit_clients clients ON clients.ip = events.ip
         WHERE events.created_at_ms > ?
         GROUP BY events.ip
         ORDER BY last_seen DESC`,
      )
      .all(cutoff)
      .map((value) => {
        const row = value as Record<string, number | string>;
        return {
          ip: String(row.ip),
          count: Number(row.count),
          remaining: Math.max(0, limit - Number(row.count)),
          resetAt: new Date(Number(row.oldest) + windowMs).toISOString(),
          totalUploads: Number(row.total),
          lastSeenAt: new Date(Number(row.last_seen)).toISOString(),
        };
      });
  }

  recordUpload(input: {
    requestId: string;
    ip: string;
    createdAt: number;
    appVersion: string;
    status: "processing" | "completed" | "failed";
    uploadBytes?: number;
    debug?: OutfitDebugInfo;
  }) {
    const analysis = input.debug?.usage?.analysis;
    const generation = input.debug?.usage?.generation;
    const totalTokens =
      analysis && generation ? analysis.totalTokens + generation.totalTokens : null;
    this.database
      .prepare(
        `INSERT OR REPLACE INTO uploads (
          request_id, ip, created_at_ms, app_version, status, upload_bytes,
          analysis_input_tokens, analysis_output_tokens,
          generation_input_tokens, generation_output_tokens, total_tokens,
          estimated_price_usd, price_is_calculated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.requestId,
        input.ip,
        input.createdAt,
        input.appVersion,
        input.status,
        input.uploadBytes ?? null,
        analysis?.inputTokens ?? null,
        analysis?.outputTokens ?? null,
        generation?.inputTokens ?? null,
        generation?.outputTokens ?? null,
        totalTokens,
        input.debug?.cost?.estimatedTotal ?? null,
        input.debug?.cost?.includesImageInputTokens ? 1 : 0,
      );
  }

  uploadHistory(limit = 100): UploadHistoryEntry[] {
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 500) : 100;
    return this.database
      .prepare(
        `SELECT request_id, ip, created_at_ms, app_version, status, upload_bytes,
                analysis_input_tokens, analysis_output_tokens,
                generation_input_tokens, generation_output_tokens, total_tokens,
                estimated_price_usd, price_is_calculated
         FROM uploads ORDER BY created_at_ms DESC LIMIT ?`,
      )
      .all(safeLimit)
      .map((value) => {
        const row = value as Record<string, number | string | null>;
        return {
          requestId: String(row.request_id),
          ip: String(row.ip),
          timestamp: new Date(Number(row.created_at_ms)).toISOString(),
          appVersion: String(row.app_version),
          status: row.status as "processing" | "completed" | "failed",
          fileSizeBytes: nullableNumber(row.upload_bytes),
          tokens: {
            analysisInput: nullableNumber(row.analysis_input_tokens),
            analysisOutput: nullableNumber(row.analysis_output_tokens),
            generationInput: nullableNumber(row.generation_input_tokens),
            generationOutput: nullableNumber(row.generation_output_tokens),
            total: nullableNumber(row.total_tokens),
          },
          price: {
            usd: nullableNumber(row.estimated_price_usd),
            kind: Number(row.price_is_calculated) === 1 ? "calculated" : "estimated",
          },
        };
      });
  }

  close() {
    this.database.close();
  }
}

function nullableNumber(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}
