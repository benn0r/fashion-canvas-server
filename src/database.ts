import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { OutfitDebugInfo, RateLimitSnapshot, UploadHistoryEntry } from "./types.js";

export interface AuthenticatedUser {
  id: number;
  username: string;
  approved: boolean;
}

export interface AdminUser extends AuthenticatedUser {
  createdAt: string;
  approvedAt: string | null;
}

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
        last_username TEXT,
        total_uploads INTEGER NOT NULL,
        last_seen_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS uploads (
        id INTEGER PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        ip TEXT NOT NULL,
        username TEXT,
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
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        approved INTEGER NOT NULL DEFAULT 0,
        created_at_ms INTEGER NOT NULL,
        approved_at_ms INTEGER
      );
      CREATE TABLE IF NOT EXISTS user_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS user_sessions_expiry ON user_sessions (expires_at_ms);
    `);
    const uploadColumns = this.database.prepare("PRAGMA table_info(uploads)").all() as Array<{
      name: string;
    }>;
    if (!uploadColumns.some((column) => column.name === "upload_bytes"))
      this.database.exec("ALTER TABLE uploads ADD COLUMN upload_bytes INTEGER");
    if (!uploadColumns.some((column) => column.name === "username"))
      this.database.exec("ALTER TABLE uploads ADD COLUMN username TEXT");
    const rateLimitClientColumns = this.database
      .prepare("PRAGMA table_info(rate_limit_clients)")
      .all() as Array<{ name: string }>;
    if (!rateLimitClientColumns.some((column) => column.name === "last_username"))
      this.database.exec("ALTER TABLE rate_limit_clients ADD COLUMN last_username TEXT");
  }

  consumeRateLimit(
    ip: string,
    limit: number,
    windowMs: number,
    now: number,
    username: string | null = null,
  ) {
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
        `INSERT INTO rate_limit_clients (ip, last_username, total_uploads, last_seen_at_ms)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(ip) DO UPDATE SET
           last_username = excluded.last_username,
           total_uploads = total_uploads + 1,
           last_seen_at_ms = excluded.last_seen_at_ms`,
      )
      .run(ip, username, now);
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
        `SELECT events.ip, clients.last_username, COUNT(*) AS count,
                MIN(events.created_at_ms) AS oldest,
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
          username: row.last_username == null ? null : String(row.last_username),
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
    username?: string;
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
          request_id, ip, username, created_at_ms, app_version, status, upload_bytes,
          analysis_input_tokens, analysis_output_tokens,
          generation_input_tokens, generation_output_tokens, total_tokens,
          estimated_price_usd, price_is_calculated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.requestId,
        input.ip,
        input.username ?? null,
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
        `SELECT request_id, ip, username, created_at_ms, app_version, status, upload_bytes,
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
          username: row.username == null ? null : String(row.username),
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

  createUser(username: string, passwordSalt: string, passwordHash: string, now = Date.now()) {
    const result = this.database
      .prepare(
        `INSERT INTO users (username, password_salt, password_hash, created_at_ms)
         VALUES (?, ?, ?, ?)`,
      )
      .run(username, passwordSalt, passwordHash, now);
    return Number(result.lastInsertRowid);
  }

  userCredentials(username: string) {
    return (this.database
      .prepare(
        `SELECT id, username, password_salt, password_hash, approved
         FROM users WHERE username = ? COLLATE NOCASE`,
      )
      .get(username) ?? null) as {
      id: number;
      username: string;
      password_salt: string;
      password_hash: string;
      approved: number;
    } | null;
  }

  createUserSession(userId: number, tokenHash: string, expiresAt: number, now = Date.now()) {
    this.database.prepare("DELETE FROM user_sessions WHERE expires_at_ms <= ?").run(now);
    this.database
      .prepare(
        `INSERT INTO user_sessions (token_hash, user_id, created_at_ms, expires_at_ms)
         VALUES (?, ?, ?, ?)`,
      )
      .run(tokenHash, userId, now, expiresAt);
  }

  userForSession(tokenHash: string, now: number): AuthenticatedUser | null {
    const row = this.database
      .prepare(
        `SELECT users.id, users.username, users.approved
         FROM user_sessions
         JOIN users ON users.id = user_sessions.user_id
         WHERE user_sessions.token_hash = ? AND user_sessions.expires_at_ms > ?`,
      )
      .get(tokenHash, now) as { id: number; username: string; approved: number } | undefined;
    return row
      ? { id: Number(row.id), username: String(row.username), approved: row.approved === 1 }
      : null;
  }

  users(): AdminUser[] {
    return this.database
      .prepare(
        `SELECT id, username, approved, created_at_ms, approved_at_ms
         FROM users ORDER BY created_at_ms DESC`,
      )
      .all()
      .map((value) => {
        const row = value as Record<string, number | string | null>;
        return {
          id: Number(row.id),
          username: String(row.username),
          approved: Number(row.approved) === 1,
          createdAt: new Date(Number(row.created_at_ms)).toISOString(),
          approvedAt:
            row.approved_at_ms == null ? null : new Date(Number(row.approved_at_ms)).toISOString(),
        };
      });
  }

  approveUser(id: number, now = Date.now()) {
    const result = this.database
      .prepare("UPDATE users SET approved = 1, approved_at_ms = ? WHERE id = ?")
      .run(now, id);
    return result.changes > 0;
  }

  revokeUserApproval(id: number) {
    const result = this.database
      .prepare("UPDATE users SET approved = 0, approved_at_ms = NULL WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  close() {
    this.database.close();
  }
}

function nullableNumber(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}
