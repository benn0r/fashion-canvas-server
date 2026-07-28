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
}

export interface RateLimitSnapshot {
  ip: string;
  count: number;
  remaining: number;
  resetAt: string;
  totalUploads: number;
  lastSeenAt: string;
}
