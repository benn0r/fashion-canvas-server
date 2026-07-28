export interface OutfitPiece {
  id: string;
  label: string;
  description: string;
  category: string;
  image: string;
}

export interface OutfitResult {
  styledOutfit: string;
  pieces: OutfitPiece[];
  debug?: OutfitDebugInfo;
}

export interface OutfitDebugInfo {
  requestId: string;
  models: { vision: string; image: string };
  input: { originalBytes: number; originalWidth?: number; originalHeight?: number; normalizedBytes: number; normalizedWidth?: number; normalizedHeight?: number; mimeType: string };
  output: { count: number; size: string; quality: string; format: string };
  timingMs: { resize: number; analysis: number; generation: number; total: number; images: Array<{ output: string; duration: number }> };
  usage: { analysis: { inputTokens: number; outputTokens: number; totalTokens: number }; generation: { available: boolean; inputTokens: number; outputTokens: number; totalTokens: number } };
  cost: { currency: "USD"; estimatedTotal: number; analysis: number | null; generation: number; includesImageInputTokens: boolean; note: string };
}

export interface RateLimitSnapshot {
  ip: string;
  count: number;
  remaining: number;
  resetAt: string;
  totalUploads: number;
  lastSeenAt: string;
}
