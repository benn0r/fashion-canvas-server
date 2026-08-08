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

export interface AdminVoucher {
  id: number;
  prefix: string;
  createdAt: string;
  usedAt: string | null;
  usedByUsername: string | null;
}

export type VoucherRedemptionResult =
  "redeemed" | "invalid" | "used" | "already_approved" | "user_not_found";

export interface DirectoryPageOptions {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface DirectoryPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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
      CREATE TABLE IF NOT EXISTS vouchers (
        id INTEGER PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        code_prefix TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        used_at_ms INTEGER,
        used_by_user_id INTEGER REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS vouchers_created ON vouchers (created_at_ms DESC);
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

  users(options: DirectoryPageOptions = {}): DirectoryPage<AdminUser> {
    const { search, page, pageSize, offset } = directoryPageOptions(options);
    const pattern = `%${escapeLikePattern(search)}%`;
    const total = Number(
      (
        this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM users
             WHERE username LIKE ? ESCAPE '\\' COLLATE NOCASE`,
          )
          .get(pattern) as { count: number }
      ).count,
    );
    const items = this.database
      .prepare(
        `SELECT id, username, approved, created_at_ms, approved_at_ms
         FROM users
         WHERE username LIKE ? ESCAPE '\\' COLLATE NOCASE
         ORDER BY created_at_ms DESC
         LIMIT ? OFFSET ?`,
      )
      .all(pattern, pageSize, offset)
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
    return directoryPage(items, total, page, pageSize);
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

  deleteUser(id: number) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const user = this.database.prepare("SELECT id FROM users WHERE id = ?").get(id);
      if (!user) {
        this.database.exec("ROLLBACK");
        return false;
      }
      this.database
        .prepare("UPDATE vouchers SET used_by_user_id = NULL WHERE used_by_user_id = ?")
        .run(id);
      this.database.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(id);
      this.database.prepare("DELETE FROM users WHERE id = ?").run(id);
      this.database.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createVoucher(codeHash: string, codePrefix: string, now = Date.now()) {
    const result = this.database
      .prepare(
        `INSERT INTO vouchers (code_hash, code_prefix, created_at_ms)
         VALUES (?, ?, ?)`,
      )
      .run(codeHash, codePrefix, now);
    return Number(result.lastInsertRowid);
  }

  vouchers(options: DirectoryPageOptions = {}): DirectoryPage<AdminVoucher> {
    const { search, page, pageSize, offset } = directoryPageOptions(options);
    const pattern = `%${escapeLikePattern(search)}%`;
    const total = Number(
      (
        this.database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM vouchers
             LEFT JOIN users ON users.id = vouchers.used_by_user_id
             WHERE vouchers.code_prefix LIKE ? ESCAPE '\\' COLLATE NOCASE
                OR COALESCE(users.username, '') LIKE ? ESCAPE '\\' COLLATE NOCASE`,
          )
          .get(pattern, pattern) as { count: number }
      ).count,
    );
    const items = this.database
      .prepare(
        `SELECT vouchers.id, vouchers.code_prefix, vouchers.created_at_ms,
                vouchers.used_at_ms, users.username AS used_by_username
         FROM vouchers
         LEFT JOIN users ON users.id = vouchers.used_by_user_id
         WHERE vouchers.code_prefix LIKE ? ESCAPE '\\' COLLATE NOCASE
            OR COALESCE(users.username, '') LIKE ? ESCAPE '\\' COLLATE NOCASE
         ORDER BY vouchers.created_at_ms DESC
         LIMIT ? OFFSET ?`,
      )
      .all(pattern, pattern, pageSize, offset)
      .map((value) => {
        const row = value as Record<string, number | string | null>;
        return {
          id: Number(row.id),
          prefix: String(row.code_prefix),
          createdAt: new Date(Number(row.created_at_ms)).toISOString(),
          usedAt: row.used_at_ms == null ? null : new Date(Number(row.used_at_ms)).toISOString(),
          usedByUsername: row.used_by_username == null ? null : String(row.used_by_username),
        };
      });
    return directoryPage(items, total, page, pageSize);
  }

  deleteVoucher(id: number) {
    return this.database.prepare("DELETE FROM vouchers WHERE id = ?").run(id).changes > 0;
  }

  redeemVoucher(codeHash: string, userId: number, now = Date.now()): VoucherRedemptionResult {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const user = this.database.prepare("SELECT approved FROM users WHERE id = ?").get(userId) as
        { approved: number } | undefined;
      if (!user) {
        this.database.exec("ROLLBACK");
        return "user_not_found";
      }
      if (user.approved === 1) {
        this.database.exec("ROLLBACK");
        return "already_approved";
      }
      const voucher = this.database
        .prepare("SELECT used_at_ms FROM vouchers WHERE code_hash = ?")
        .get(codeHash) as { used_at_ms: number | null } | undefined;
      if (!voucher) {
        this.database.exec("ROLLBACK");
        return "invalid";
      }
      if (voucher.used_at_ms != null) {
        this.database.exec("ROLLBACK");
        return "used";
      }
      const consumed = this.database
        .prepare(
          `UPDATE vouchers SET used_at_ms = ?, used_by_user_id = ?
           WHERE code_hash = ? AND used_at_ms IS NULL`,
        )
        .run(now, userId, codeHash);
      if (consumed.changes !== 1) {
        this.database.exec("ROLLBACK");
        return "used";
      }
      this.database
        .prepare("UPDATE users SET approved = 1, approved_at_ms = ? WHERE id = ?")
        .run(now, userId);
      this.database.exec("COMMIT");
      return "redeemed";
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}

function nullableNumber(value: number | string | null | undefined): number | null {
  return value == null ? null : Number(value);
}

function directoryPageOptions(options: DirectoryPageOptions) {
  const page = Number.isFinite(options.page) ? Math.max(1, Math.trunc(options.page ?? 1)) : 1;
  const pageSize = Number.isFinite(options.pageSize)
    ? Math.min(100, Math.max(1, Math.trunc(options.pageSize ?? 20)))
    : 20;
  const search = (options.search ?? "").trim().slice(0, 100);
  return { search, page, pageSize, offset: (page - 1) * pageSize };
}

function directoryPage<T>(items: T[], total: number, page: number, pageSize: number) {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

function escapeLikePattern(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
