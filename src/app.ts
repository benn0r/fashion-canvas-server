import express from "express";
import helmet from "helmet";
import multer from "multer";
import path from "node:path";
import { UploadRateLimiter } from "./rate-limit.js";
import type { OutfitResult } from "./types.js";

export interface OutfitTransformer { transform(buffer: Buffer, mimeType: string): Promise<OutfitResult> }

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

  app.get("/health", (_request, response) => response.json({ status: "ok" }));
  app.get("/api/debug/rate-limits", (_request, response) => response.json({ limit: limiter.limit, windowSeconds: limiter.windowMs / 1000, clients: limiter.snapshots() }));
  app.post("/api/outfits", limiter.middleware, upload.single("photo"), async (request, response, next) => {
    try {
      if (!request.file) return response.status(400).json({ error: "A JPEG, PNG, WebP, HEIC, or HEIF photo is required in the 'photo' field." });
      const result = await transformer.transform(request.file.buffer, request.file.mimetype);
      response.json(result);
    } catch (error) { next(error); }
  });
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = error instanceof multer.MulterError ? 400 : 502;
    console.error("Request failed", { message });
    response.status(status).json({ error: status === 502 ? "The outfit could not be generated. Please try again." : message });
  });
  return app;
}
