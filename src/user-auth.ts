import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppDatabase, AuthenticatedUser } from "./database.js";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeUsername(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validUsername(username: string) {
  return /^[a-z0-9_-]{3,32}$/.test(username);
}

export function validPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 8 && password.length <= 128;
}

export function hashPassword(password: string, salt = randomBytes(16).toString("base64")) {
  return { salt, hash: scryptSync(password, salt, 64).toString("base64") };
}

export function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSession(database: AppDatabase, userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  database.createUserSession(userId, hashToken(token), expiresAt);
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function generateVoucherCode() {
  const value = randomBytes(16).toString("hex").toUpperCase();
  return `FC-${value.slice(0, 8)}-${value.slice(8, 16)}-${value.slice(16, 24)}-${value.slice(24)}`;
}

export function normalizeVoucherCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export function validVoucherCode(value: string) {
  return /^FC-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/.test(value);
}

export function hashVoucherCode(value: string) {
  return createHash("sha256").update(value).digest("base64");
}

export function requireUser(database: AppDatabase) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const user = authenticateRequest(database, request);
    if (!user) {
      response.setHeader("WWW-Authenticate", "Bearer");
      response.status(401).json({
        code: "authentication_required",
        error: "Log in to continue.",
      });
      return;
    }
    response.locals.user = user;
    next();
  };
}

export function requireApprovedUser(database: AppDatabase) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const user = authenticateRequest(database, request);
    if (!user) {
      response.setHeader("WWW-Authenticate", "Bearer");
      response.status(401).json({
        code: "authentication_required",
        error: "Log in before uploading files.",
      });
      return;
    }
    if (!user.approved) {
      response.status(403).json({
        code: "approval_required",
        error: "Your account is awaiting administrator approval.",
      });
      return;
    }
    response.locals.user = user;
    next();
  };
}

function authenticateRequest(database: AppDatabase, request: Request): AuthenticatedUser | null {
  const authorization = request.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token ? database.userForSession(hashToken(token), Date.now()) : null;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("base64");
}
