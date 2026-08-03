import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import { UploadRateLimiter } from "../../src/rate-limit.js";
import { AppDatabase } from "../../src/database.js";

test("allows ten uploads and rejects the eleventh for one client", async () => {
  const database = new AppDatabase(":memory:");
  const limiter = new UploadRateLimiter(10, 300_000, () => 1_000, database);
  const app = express()
    .set("trust proxy", 1)
    .post("/", limiter.middleware, (_req, res) => res.sendStatus(204));
  for (let i = 0; i < 10; i++)
    assert.equal((await request(app).post("/").set("X-Forwarded-For", "203.0.113.9")).status, 204);
  const blocked = await request(app).post("/").set("X-Forwarded-For", "203.0.113.9");
  assert.equal(blocked.status, 429);
  assert.equal(limiter.snapshots()[0]?.count, 10);
  assert.equal(limiter.snapshots()[0]?.totalUploads, 10);
  database.close();
});

test("tracks clients independently and resets after the rolling window", async () => {
  let now = 10_000;
  const database = new AppDatabase(":memory:");
  const limiter = new UploadRateLimiter(1, 100, () => now, database);
  const app = express()
    .set("trust proxy", 1)
    .post("/", limiter.middleware, (_req, res) => res.sendStatus(204));
  assert.equal((await request(app).post("/").set("X-Forwarded-For", "198.51.100.1")).status, 204);
  assert.equal((await request(app).post("/").set("X-Forwarded-For", "198.51.100.2")).status, 204);
  now += 101;
  assert.equal((await request(app).post("/").set("X-Forwarded-For", "198.51.100.1")).status, 204);
  assert.equal(limiter.snapshots()[0]?.totalUploads, 2);
  database.close();
});

test("shares rate limits through persistent SQLite state", async () => {
  const database = new AppDatabase(":memory:");
  const first = new UploadRateLimiter(1, 300_000, () => 5_000, database);
  const second = new UploadRateLimiter(1, 300_000, () => 5_001, database);
  const firstApp = express().post("/", first.middleware, (_req, res) => res.sendStatus(204));
  const secondApp = express().post("/", second.middleware, (_req, res) => res.sendStatus(204));
  assert.equal((await request(firstApp).post("/")).status, 204);
  assert.equal((await request(secondApp).post("/")).status, 429);
  database.close();
});
