import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../src/app.js";

const transformer = { async transform() { return { styledOutfit: "data:image/jpeg;base64,AA==", pieces: [{ id: "top-1", label: "Knit", description: "Red knit top", category: "top", image: "data:image/jpeg;base64,AA==" }] }; } };

test("health and debug endpoints expose service state", async () => {
  const app = createApp(transformer);
  assert.deepEqual((await request(app).get("/health")).body, { status: "ok" });
  const config = (await request(app).get("/api/debug/config")).body;
  assert.equal(config.inputMaxDimension, 1280);
  assert.equal(config.outputSize, "1024x1024");
  assert.equal(config.outputQuality, "low");
  const debug = (await request(app).get("/api/debug/rate-limits")).body;
  assert.equal(debug.limit, 10);
  assert.deepEqual(debug.clients, []);
});

test("outfit endpoint validates and transforms an image", async () => {
  const app = createApp(transformer);
  assert.equal((await request(app).post("/api/outfits")).status, 400);
  const result = await request(app).post("/api/outfits").attach("photo", Buffer.from("fake"), { filename: "look.jpg", contentType: "image/jpeg" });
  assert.equal(result.status, 200);
  assert.equal(result.body.pieces[0].label, "Knit");
});
