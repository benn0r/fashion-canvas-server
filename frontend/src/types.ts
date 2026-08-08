export interface RateLimitClient {
  ip: string;
  username: string | null;
  count: number;
  remaining: number;
  totalUploads: number;
}

export interface RateLimitsResponse {
  limit: number;
  clients: RateLimitClient[];
}

export interface UploadHistoryItem {
  requestId: string;
  username: string | null;
  ip: string;
  timestamp: string;
  appVersion: string;
  status: "processing" | "completed" | "failed";
  fileSizeBytes: number | null;
  tokens: { total: number | null };
  price: { usd: number | null; kind: "estimated" | "calculated" };
}

export interface UserAccount {
  id: number;
  username: string;
  approved: boolean;
  createdAt: string;
}

export interface ApprovalVoucher {
  id: number;
  prefix: string;
  createdAt: string;
  usedAt: string | null;
  usedByUsername: string | null;
}

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
  debug?: {
    requestId: string;
    cost: { estimatedTotal: number; currency: string; note: string };
    models: { vision: string; image: string };
    output: {
      fullOutfitSize: string;
      pieceSize: string;
      count: number;
      quality: string;
      format: string;
    };
    timingMs: { total: number; resize: number; analysis: number; generation: number };
    usage: {
      analysis: { totalTokens: number };
      generation: { available: boolean; totalTokens: number };
    };
    input: {
      originalWidth?: number;
      originalHeight?: number;
      originalBytes: number;
      normalizedWidth?: number;
      normalizedHeight?: number;
      normalizedBytes: number;
    };
  };
}
