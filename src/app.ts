import express from "express";
import helmet from "helmet";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { logError, logEvent } from "./log.js";
import { UploadRateLimiter } from "./rate-limit.js";
import type { OutfitResult } from "./types.js";
import { AppDatabase } from "./database.js";
import { adminAuth, loadAdminCredentials, type AdminCredentials } from "./admin-auth.js";
import { openApiDocument } from "./openapi.js";
import {
  createSession,
  generateVoucherCode,
  hashPassword,
  hashVoucherCode,
  normalizeUsername,
  normalizeVoucherCode,
  requireApprovedUser,
  requireUser,
  validPassword,
  validUsername,
  validVoucherCode,
  verifyPassword,
} from "./user-auth.js";

export interface OutfitTransformer {
  transform(
    buffer: Buffer,
    mimeType: string,
    context?: { requestId: string },
  ): Promise<OutfitResult>;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) =>
    callback(
      null,
      ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.mimetype),
    ),
});

export function createApp(
  transformer: OutfitTransformer,
  database = new AppDatabase(),
  limiter = new UploadRateLimiter(10, 5 * 60_000, Date.now, database),
  adminCredentials: AdminCredentials | null = loadAdminCredentials(),
  trustProxy: number | string[] = proxyTrustSetting(process.env.TRUST_PROXY),
) {
  const app = express();
  app.set("trust proxy", trustProxy);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "32kb" }));
  app.use(adminAuth(adminCredentials));
  const publicDirectory = path.resolve(process.cwd(), "public");
  app.use(express.static(publicDirectory));
  app.get("/api-docs/openapi.json", (_request, response) => response.json(openApiDocument));
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "Fashion Canvas API",
      customfavIcon: "/app-icon.png",
      customCss:
        ".swagger-ui .topbar { display: none } .swagger-ui .info .title { font-family: Georgia, serif }",
      swaggerOptions: { displayRequestDuration: true, persistAuthorization: true },
    }),
  );

  app.use(["/api/auth", "/api/outfits"], (request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-App-Version",
    );
    response.setHeader("Access-Control-Max-Age", "86400");
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  });

  app.post("/api/auth/register", (request, response) => {
    const username = normalizeUsername(request.body?.username);
    const password = request.body?.password;
    if (!validUsername(username))
      return response.status(400).json({
        code: "invalid_username",
        error: "Username must be 3–32 characters using letters, numbers, underscores, or hyphens.",
      });
    if (!validPassword(password))
      return response.status(400).json({
        code: "invalid_password",
        error: "Password must be between 8 and 128 characters.",
      });
    const passwordData = hashPassword(password);
    try {
      database.createUser(username, passwordData.salt, passwordData.hash);
      return response.status(201).json({
        username,
        approved: false,
        message: "Registration complete. An administrator must approve your account.",
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed"))
        return response.status(409).json({
          code: "username_taken",
          error: "That username is already registered.",
        });
      throw error;
    }
  });

  app.post("/api/auth/login", (request, response) => {
    const username = normalizeUsername(request.body?.username);
    const password = request.body?.password;
    const user = validPassword(password) ? database.userCredentials(username) : null;
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash))
      return response.status(401).json({
        code: "invalid_credentials",
        error: "Invalid username or password.",
      });
    const session = createSession(database, user.id);
    return response.json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: { username: user.username, approved: user.approved === 1 },
    });
  });

  app.post("/api/auth/vouchers/redeem", requireUser(database), (request, response) => {
    const code = normalizeVoucherCode(request.body?.voucher);
    if (!validVoucherCode(code))
      return response.status(400).json({
        code: "invalid_voucher",
        error: "Enter a valid approval voucher.",
      });
    const result = database.redeemVoucher(hashVoucherCode(code), Number(response.locals.user.id));
    if (result === "invalid")
      return response.status(400).json({
        code: "invalid_voucher",
        error: "This approval voucher is invalid.",
      });
    if (result === "used")
      return response.status(409).json({
        code: "voucher_already_used",
        error: "This approval voucher has already been used.",
      });
    if (result === "already_approved")
      return response.status(409).json({
        code: "account_already_approved",
        error: "Your account is already approved.",
      });
    if (result === "user_not_found")
      return response.status(401).json({
        code: "authentication_required",
        error: "Log in again to continue.",
      });
    return response.json({
      approved: true,
      message: "Your account has been approved.",
    });
  });

  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/api/debug/config", (_request, response) =>
    response.json({
      visionModel: process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini",
      imageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
      inputMaxDimension: Number(process.env.INPUT_MAX_DIMENSION ?? 1280),
      fullOutfitSize: "1024x1024",
      pieceSize: "816x816",
      outputQuality: "low",
      maxUploadBytes: 12 * 1024 * 1024,
      rateLimit: { uploads: limiter.limit, windowSeconds: limiter.windowMs / 1000 },
    }),
  );
  app.get("/api/debug/rate-limits", (_request, response) =>
    response.json({
      limit: limiter.limit,
      windowSeconds: limiter.windowMs / 1000,
      clients: limiter.snapshots(),
    }),
  );
  app.get("/api/admin/uploads", (request, response) =>
    response.json({ uploads: database.uploadHistory(Number(request.query.limit ?? 100)) }),
  );
  app.get("/api/admin/users", (request, response) => {
    const result = database.users(directoryQuery(request));
    return response.json({ users: result.items, pagination: paginationResponse(result) });
  });
  app.get("/api/admin/vouchers", (request, response) => {
    const result = database.vouchers(directoryQuery(request));
    return response.json({ vouchers: result.items, pagination: paginationResponse(result) });
  });
  app.post("/api/admin/vouchers", (_request, response) => {
    const code = generateVoucherCode();
    const createdAt = Date.now();
    const id = database.createVoucher(hashVoucherCode(code), code.slice(0, 11), createdAt);
    return response.status(201).json({
      voucher: {
        id,
        code,
        prefix: code.slice(0, 11),
        createdAt: new Date(createdAt).toISOString(),
        usedAt: null,
        usedByUsername: null,
      },
    });
  });
  app.post("/api/admin/users/:id/approve", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1 || !database.approveUser(id))
      return response.status(404).json({ code: "user_not_found", error: "User not found." });
    return response.json({ approved: true });
  });
  app.post("/api/admin/users/:id/revoke", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1 || !database.revokeUserApproval(id))
      return response.status(404).json({ code: "user_not_found", error: "User not found." });
    return response.json({ approved: false });
  });
  app.delete("/api/admin/users/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1 || !database.deleteUser(id))
      return response.status(404).json({ code: "user_not_found", error: "User not found." });
    return response.sendStatus(204);
  });
  app.delete("/api/admin/vouchers/:id", (request, response) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id < 1 || !database.deleteVoucher(id))
      return response.status(404).json({ code: "voucher_not_found", error: "Voucher not found." });
    return response.sendStatus(204);
  });
  app.post(
    "/api/outfits",
    requireApprovedUser(database),
    limiter.middleware,
    upload.single("photo"),
    async (request, response, next) => {
      const requestId = randomUUID();
      const ip = request.ip || request.socket.remoteAddress || "unknown";
      const username = String(response.locals.user.username);
      const appVersion = request.get("X-App-Version")?.slice(0, 100) || "web";
      response.locals.requestId = requestId;
      const startedAt = Date.now();
      let uploadBytes: number | undefined;
      try {
        if (!request.file) {
          logEvent("upload_rejected", { requestId, reason: "missing_or_unsupported_photo" });
          return response.status(400).json({
            error: "A JPEG, PNG, WebP, HEIC, or HEIF photo is required in the 'photo' field.",
          });
        }
        logEvent("upload_received", {
          requestId,
          mimeType: request.file.mimetype,
          bytes: request.file.size,
        });
        uploadBytes = request.file.size;
        database.recordUpload({
          requestId,
          ip,
          username,
          createdAt: startedAt,
          appVersion,
          status: "processing",
          uploadBytes,
        });
        const result = await transformer.transform(request.file.buffer, request.file.mimetype, {
          requestId,
        });
        database.recordUpload({
          requestId,
          ip,
          username,
          createdAt: startedAt,
          appVersion,
          status: "completed",
          uploadBytes,
          debug: result.debug,
        });
        logEvent("request_completed", {
          requestId,
          pieces: result.pieces.length,
          durationMs: Date.now() - startedAt,
        });
        response.json(result);
      } catch (error) {
        database.recordUpload({
          requestId,
          ip,
          username,
          createdAt: startedAt,
          appVersion,
          status: "failed",
          uploadBytes,
        });
        next(error);
      }
    },
  );
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const message = error instanceof Error ? error.message : "Unexpected error";
      const status = error instanceof multer.MulterError ? 400 : 502;
      logError("request_failed", { requestId: response.locals.requestId, message });
      response.status(status).json({
        error: status === 502 ? "The outfit could not be generated. Please try again." : message,
      });
    },
  );
  return app;
}

function proxyTrustSetting(value: string | undefined): number | string[] {
  if (!value) return ["loopback", "linklocal", "uniquelocal"];
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0
    ? numeric
    : value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function directoryQuery(request: express.Request) {
  return {
    search: typeof request.query.search === "string" ? request.query.search : "",
    page: Number(request.query.page ?? 1),
    pageSize: Number(request.query.pageSize ?? 20),
  };
}

function paginationResponse(result: {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}) {
  return {
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  };
}
