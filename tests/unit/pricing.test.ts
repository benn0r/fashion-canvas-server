import test from "node:test";
import assert from "node:assert/strict";
import { estimateImageCost, estimateVisionCost } from "../../src/pricing.js";

test("estimates known vision-model token cost", () => {
  assert.equal(estimateVisionCost("gpt-4.1-mini", { inputTokens: 1000, outputTokens: 100 }), 0.00056);
  assert.equal(estimateVisionCost("unknown", { inputTokens: 1000, outputTokens: 100 }), null);
});

test("uses documented low-quality fallback or detailed image usage", () => {
  assert.deepEqual(estimateImageCost(), { usd: 0.006, includesInput: false });
  assert.equal(estimateImageCost(undefined, "816x816").usd, 0.00381005859375);
  assert.deepEqual(estimateImageCost({ inputTokens: 1100, imageInputTokens: 1000, textInputTokens: 100, outputTokens: 200 }), { usd: 0.0145, includesInput: true });
});
