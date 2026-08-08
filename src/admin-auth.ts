import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NextFunction, Request, Response } from "express";

export interface AdminCredentials {
  username: string;
  password: string;
}

export function loadAdminCredentials(): AdminCredentials | null {
  const usernameFile = process.env.ADMIN_USERNAME_FILE;
  const passwordFile = process.env.ADMIN_PASSWORD_FILE;
  if (!usernameFile || !passwordFile) {
    if (process.env.NODE_ENV === "production")
      throw new Error("ADMIN_USERNAME_FILE and ADMIN_PASSWORD_FILE are required in production");
    return null;
  }
  const credentials = {
    username: readFileSync(usernameFile, "utf8").trim(),
    password: readFileSync(passwordFile, "utf8").trim(),
  };
  if (!credentials.username || !credentials.password)
    throw new Error("Admin credential files must not be empty");
  return credentials;
}

export function adminAuth(credentials: AdminCredentials | null) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (!credentials || !isProtectedPath(request.path)) return next();
    const supplied = parseBasicCredentials(request.get("Authorization"));
    if (
      supplied &&
      safelyEqual(supplied.username, credentials.username) &&
      safelyEqual(supplied.password, credentials.password)
    )
      return next();
    response.setHeader("WWW-Authenticate", 'Basic realm="Fashion Canvas Admin", charset="UTF-8"');
    response.setHeader("Cache-Control", "no-store");
    response.status(401).send("Authentication required");
  };
}

function isProtectedPath(pathname: string) {
  return (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname === "/studio.html" ||
    pathname === "/users.html" ||
    pathname.startsWith("/api-docs") ||
    pathname.startsWith("/api/admin/") ||
    pathname.startsWith("/api/debug/")
  );
}

function parseBasicCredentials(header: string | undefined): AdminCredentials | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function safelyEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
