import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../../src/app.js";
import { AppDatabase } from "../../src/database.js";

const transformer = {
  async transform() {
    return {
      styledOutfit: "data:image/jpeg;base64,AA==",
      pieces: [
        {
          id: "top-1",
          label: "Knit",
          description: "Red knit top",
          category: "top",
          image: "data:image/jpeg;base64,AA==",
        },
      ],
      debug: { cost: { estimatedTotal: 0.012 } },
    };
  },
};

test("health and debug endpoints expose service state", async () => {
  const database = new AppDatabase(":memory:");
  const app = createApp(transformer, database);
  assert.deepEqual((await request(app).get("/health")).body, { status: "ok" });
  const config = (await request(app).get("/api/debug/config")).body;
  assert.equal(config.inputMaxDimension, 1280);
  assert.equal(config.fullOutfitSize, "1024x1024");
  assert.equal(config.pieceSize, "816x816");
  assert.equal(config.outputQuality, "low");
  const debug = (await request(app).get("/api/debug/rate-limits")).body;
  assert.equal(debug.limit, 10);
  assert.deepEqual(debug.clients, []);
  database.close();
});

test("protects admin pages and operational APIs with HTTP Basic Auth", async () => {
  const database = new AppDatabase(":memory:");
  const app = createApp(transformer, database, undefined, {
    username: "test-admin",
    password: "test-password",
  });
  for (const pathname of ["/", "/studio.html", "/api/admin/uploads", "/api/debug/config"]) {
    const unauthorized = await request(app).get(pathname);
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers["www-authenticate"], /^Basic realm=/);
    assert.equal((await request(app).get(pathname).auth("test-admin", "wrong")).status, 401);
    assert.notEqual(
      (await request(app).get(pathname).auth("test-admin", "test-password")).status,
      401,
    );
  }
  assert.equal((await request(app).get("/health")).status, 200);
  assert.equal((await request(app).post("/api/outfits")).status, 400);
  database.close();
});

test("outfit endpoint validates and transforms an image", async () => {
  const database = new AppDatabase(":memory:");
  const app = createApp(transformer, database);
  const preflight = await request(app)
    .options("/api/outfits")
    .set("Origin", "http://localhost:8081")
    .set("Access-Control-Request-Method", "POST");
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "*");
  assert.equal((await request(app).post("/api/outfits")).status, 400);
  const result = await request(app)
    .post("/api/outfits")
    .set("X-App-Version", "ios/2.4.0")
    .attach("photo", Buffer.from("fake"), { filename: "look.jpg", contentType: "image/jpeg" });
  assert.equal(result.status, 200);
  assert.equal(result.headers["access-control-allow-origin"], "*");
  assert.equal(result.body.pieces[0].label, "Knit");
  assert.equal(result.body.debug.cost.estimatedTotal, 0.012);
  const history = (await request(app).get("/api/admin/uploads")).body.uploads;
  assert.equal(history.length, 1);
  assert.equal(history[0].appVersion, "ios/2.4.0");
  assert.equal(history[0].status, "completed");
  assert.equal(history[0].fileSizeBytes, 4);
  assert.equal(history[0].price.usd, 0.012);
  assert.equal(history[0].price.kind, "estimated");
  assert.equal(history[0].tokens.total, null);
  assert.equal(JSON.stringify(history).includes("data:image"), false);
  database.close();
});

test("records failed transformations without storing image contents", async () => {
  const database = new AppDatabase(":memory:");
  const app = createApp(
    { transform: async () => Promise.reject(new Error("upstream unavailable")) },
    database,
  );
  const result = await request(app)
    .post("/api/outfits")
    .attach("photo", Buffer.from("secret-image-bytes"), {
      filename: "look.jpg",
      contentType: "image/jpeg",
    });
  assert.equal(result.status, 502);
  const history = (await request(app).get("/api/admin/uploads")).body.uploads;
  assert.equal(history[0].status, "failed");
  assert.equal(history[0].fileSizeBytes, 18);
  assert.equal(JSON.stringify(history).includes("secret-image-bytes"), false);
  database.close();
});

test("shows an upload as processing before the transformation completes", async () => {
  const database = new AppDatabase(":memory:");
  let releaseTransform!: () => void;
  let signalStarted!: () => void;
  const transformStarted = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const transformReleased = new Promise<void>((resolve) => {
    releaseTransform = resolve;
  });
  const app = createApp(
    {
      async transform() {
        signalStarted();
        await transformReleased;
        return transformer.transform();
      },
    },
    database,
  );
  const responsePromise = request(app)
    .post("/api/outfits")
    .attach("photo", Buffer.from("fake"), {
      filename: "look.jpg",
      contentType: "image/jpeg",
    })
    .then((response) => response);

  await transformStarted;
  const processing = (await request(app).get("/api/admin/uploads")).body.uploads;
  assert.equal(processing[0].status, "processing");
  assert.equal(processing[0].fileSizeBytes, 4);
  releaseTransform();
  assert.equal((await responsePromise).status, 200);
  const completed = (await request(app).get("/api/admin/uploads")).body.uploads;
  assert.equal(completed.length, 1);
  assert.equal(completed[0].status, "completed");
  assert.equal(completed[0].requestId, processing[0].requestId);
  assert.equal(completed[0].fileSizeBytes, 4);
  database.close();
});

test("migrates an existing upload history database with the file-size column", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "fashion-canvas-migration-"));
  const filename = path.join(directory, "history.sqlite");
  const legacy = new DatabaseSync(filename);
  legacy.exec(`
    CREATE TABLE uploads (
      id INTEGER PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      ip TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      app_version TEXT NOT NULL,
      status TEXT NOT NULL,
      analysis_input_tokens INTEGER,
      analysis_output_tokens INTEGER,
      generation_input_tokens INTEGER,
      generation_output_tokens INTEGER,
      total_tokens INTEGER,
      estimated_price_usd REAL,
      price_is_calculated INTEGER NOT NULL DEFAULT 0
    );
  `);
  legacy.close();

  const database = new AppDatabase(filename);
  database.recordUpload({
    requestId: "migration-request",
    ip: "192.0.2.10",
    createdAt: 123,
    appVersion: "web",
    status: "processing",
    uploadBytes: 2048,
  });
  assert.equal(database.uploadHistory()[0]?.fileSizeBytes, 2048);
  database.close();
  rmSync(directory, { recursive: true });
});
