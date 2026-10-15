type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

export function consumeRateLimit(key: string, limitPerMinute: number): boolean {
  if (limitPerMinute <= 0) {
    return true;
  }
  const now = Date.now();
  const windowStart = now - 60_000;
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((stamp) => stamp > windowStart);
  if (bucket.timestamps.length >= limitPerMinute) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return true;
}

export function resetRateLimits() {
  buckets.clear();
}
