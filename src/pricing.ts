export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  imageInputTokens?: number;
  textInputTokens?: number;
}

const VISION_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
};

export function estimateVisionCost(model: string, usage: TokenUsage) {
  const price = VISION_PRICES[model];
  if (!price) return null;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

export function estimateImageCost(usage?: TokenUsage) {
  if (!usage) return { usd: 0.006, includesInput: false };
  const imageInput = usage.imageInputTokens ?? 0;
  const textInput = usage.textInputTokens ?? Math.max(0, usage.inputTokens - imageInput);
  return { usd: (imageInput * 8 + textInput * 5 + usage.outputTokens * 30) / 1_000_000, includesInput: true };
}
