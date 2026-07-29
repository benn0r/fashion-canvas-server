import express from "express";
import helmet from "helmet";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { logError, logEvent } from "./log.js";
import { UploadRateLimiter } from "./rate-limit.js";
import type { OutfitResult } from "./types.js";

export interface OutfitTransformer { transform(buffer: Buffer, mimeType: string, context?: { requestId: string }): Promise<OutfitResult> }

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => callback(null, ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"].includes(file.mimetype)),
});

export function createApp(transformer: OutfitTransformer, limiter = new UploadRateLimiter()) {
  const app = express();
  app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "32kb" }));
  const publicDirectory = path.resolve(process.cwd(), "public");
  app.use(express.static(publicDirectory));

  app.use("/api/outfits", (request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Max-Age", "86400");
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  });

  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/api/debug/config", (_request, response) => response.json({
    visionModel: process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini",
    imageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
    inputMaxDimension: Number(process.env.INPUT_MAX_DIMENSION ?? 1280),
    fullOutfitSize: "1024x1024",
    pieceSize: "816x816",
    outputQuality: "low",
    maxUploadBytes: 12 * 1024 * 1024,
    rateLimit: { uploads: limiter.limit, windowSeconds: limiter.windowMs / 1000 },
  }));
  app.get("/api/debug/rate-limits", (_request, response) => response.json({ limit: limiter.limit, windowSeconds: limiter.windowMs / 1000, clients: limiter.snapshots() }));
  app.post("/api/outfits", limiter.middleware, upload.single("photo"), async (request, response, next) => {
    const requestId = randomUUID();
    response.locals.requestId = requestId;
    const startedAt = Date.now();
    try {
      if (!request.file) {
        logEvent("upload_rejected", { requestId, reason: "missing_or_unsupported_photo" });
        return response.status(400).json({ error: "A JPEG, PNG, WebP, HEIC, or HEIF photo is required in the 'photo' field." });
      }
      logEvent("upload_received", { requestId, mimeType: request.file.mimetype, bytes: request.file.size });
      const result = await transformer.transform(request.file.buffer, request.file.mimetype, { requestId });
      logEvent("request_completed", { requestId, pieces: result.pieces.length, durationMs: Date.now() - startedAt });
      response.json(result);
    } catch (error) { next(error); }
  });
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = error instanceof multer.MulterError ? 400 : 502;
    logError("request_failed", { requestId: response.locals.requestId, message });
    response.status(status).json({ error: status === 502 ? "The outfit could not be generated. Please try again." : message });
  });
  return app;
}
