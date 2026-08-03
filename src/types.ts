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
  input: {
    originalBytes: number;
    originalWidth?: number;
    originalHeight?: number;
    normalizedBytes: number;
    normalizedWidth?: number;
    normalizedHeight?: number;
    mimeType: string;
  };
  output: {
    count: number;
    fullOutfitSize: string;
    pieceSize: string;
    quality: string;
    format: string;
  };
  timingMs: {
    resize: number;
    analysis: number;
    generation: number;
    total: number;
    images: Array<{ output: string; duration: number }>;
  };
  usage: {
    analysis: { inputTokens: number; outputTokens: number; totalTokens: number };
    generation: {
      available: boolean;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  };
  cost: {
    currency: "USD";
    estimatedTotal: number;
    analysis: number | null;
    generation: number;
    includesImageInputTokens: boolean;
    note: string;
  };
}

export interface RateLimitSnapshot {
  ip: string;
  count: number;
  remaining: number;
  resetAt: string;
  totalUploads: number;
  lastSeenAt: string;
}

export interface UploadHistoryEntry {
  requestId: string;
  ip: string;
  timestamp: string;
  appVersion: string;
  status: "processing" | "completed" | "failed";
  fileSizeBytes: number | null;
  tokens: {
    analysisInput: number | null;
    analysisOutput: number | null;
    generationInput: number | null;
    generationOutput: number | null;
    total: number | null;
  };
  price: { usd: number | null; kind: "estimated" | "calculated" };
}
