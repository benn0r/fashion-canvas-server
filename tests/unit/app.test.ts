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

async function approvedToken(app: ReturnType<typeof createApp>, username = "approved-user") {
  const password = "correct-horse-battery";
  const registration = await request(app).post("/api/auth/register").send({ username, password });
  assert.equal(registration.status, 201);
  const users = (await request(app).get("/api/admin/users")).body.users;
  assert.equal((await request(app).post(`/api/admin/users/${users[0].id}/approve`)).status, 200);
  const login = await request(app).post("/api/auth/login").send({ username, password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.approved, true);
  return login.body.token as string;
}

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
  for (const pathname of [
    "/",
    "/studio.html",
    "/users.html",
    "/api/admin/uploads",
    "/api/admin/users",
    "/api/debug/config",
  ]) {
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
  assert.equal((await request(app).get("/account.html")).status, 200);
  assert.equal((await request(app).post("/api/outfits")).status, 401);
  database.close();
});

test("registers users and requires admin approval before uploads", async () => {
  const database = new AppDatabase(":memory:");
  const app = createApp(transformer, database);
  assert.equal(
    (await request(app).post("/api/auth/register").send({ username: "x", password: "short" }))
      .status,
    400,
  );
  const registered = await request(app)
    .post("/api/auth/register")
    .send({ username: "New_User", password: "long-enough-password" });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.username, "new_user");
  assert.equal(registered.body.approved, false);
  assert.equal(
    (
      await request(app)
        .post("/api/auth/register")
        .send({ username: "new_user", password: "another-password" })
    ).status,
    409,
  );
  assert.equal(
    (
      await request(app)
        .post("/api/auth/login")
        .send({ username: "new_user", password: "wrong-password" })
    ).status,
    401,
  );
  const login = await request(app)
    .post("/api/auth/login")
    .send({ username: "new_user", password: "long-enough-password" });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.approved, false);
  const pending = await request(app)
    .post("/api/outfits")
    .set("Authorization", `Bearer ${login.body.token}`);
  assert.equal(pending.status, 403);
  assert.equal(pending.body.code, "approval_required");
  const users = (await request(app).get("/api/admin/users")).body.users;
  assert.equal(users[0].username, "new_user");
  assert.equal(users[0].approved, false);
  assert.equal(JSON.stringify(users).includes("password"), false);
  assert.equal((await request(app).post(`/api/admin/users/${users[0].id}/approve`)).status, 200);
  const approvedUpload = await request(app)
    .post("/api/outfits")
    .set("Authorization", `Bearer ${login.body.token}`);
  assert.equal(approvedUpload.status, 400);
  database.close();
});

test("outfit endpoint validates and transforms an image", async () => {
  const database = new AppDatabase(":memory:");
  const app = createApp(transformer, database, undefined, undefined, 2);
  const token = await approvedToken(app);
  const preflight = await request(app)
    .options("/api/outfits")
    .set("Origin", "http://localhost:8081")
    .set("Access-Control-Request-Method", "POST");
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], "*");
  assert.match(preflight.headers["access-control-allow-headers"], /Authorization/);
  assert.equal((await request(app).post("/api/outfits")).status, 401);
  const result = await request(app)
    .post("/api/outfits")
    .set("Authorization", `Bearer ${token}`)
    .set("X-App-Version", "ios/2.4.0")
    .set("X-Forwarded-For", "203.0.113.99, 198.51.100.24, 10.0.0.8")
    .attach("photo", Buffer.from("fake"), { filename: "look.jpg", contentType: "image/jpeg" });
  assert.equal(result.status, 200);
  assert.equal(result.headers["access-control-allow-origin"], "*");
  assert.equal(result.body.pieces[0].label, "Knit");
  assert.equal(result.body.debug.cost.estimatedTotal, 0.012);
  const history = (await request(app).get("/api/admin/uploads")).body.uploads;
  assert.equal(history.length, 1);
  assert.equal(history[0].appVersion, "ios/2.4.0");
  assert.equal(history[0].ip, "198.51.100.24");
  assert.equal(history[0].status, "completed");
  assert.equal(history[0].fileSizeBytes, 4);
  assert.equal(history[0].price.usd, 0.012);
  assert.equal(history[0].price.kind, "estimated");
  assert.equal(history[0].tokens.total, null);
  assert.equal(JSON.stringify(history).includes("data:image"), false);
  const limits = (await request(app).get("/api/debug/rate-limits")).body.clients;
  assert.equal(limits.find((client: { ip: string }) => client.ip === "198.51.100.24")?.count, 1);
  assert.equal(
    limits.some((client: { ip: string }) => client.ip === "203.0.113.99"),
    false,
  );
  database.close();
});

test("records failed transformations without storing image contents", async () => {
  const database = new AppDatabase(":memory:");
  const app = createApp(
    { transform: async () => Promise.reject(new Error("upstream unavailable")) },
    database,
  );
  const token = await approvedToken(app);
  const result = await request(app)
    .post("/api/outfits")
    .set("Authorization", `Bearer ${token}`)
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
  const token = await approvedToken(app);
  const responsePromise = request(app)
    .post("/api/outfits")
    .set("Authorization", `Bearer ${token}`)
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
