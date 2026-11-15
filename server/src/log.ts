export interface UsageEntry {
  tool: string;
  country: string | null;
  city: string | null;
  metal: string | null;
  latency_ms: number;
  error_code: string | null;
}

export function logUsage(entry: UsageEntry, write: (line: string) => void = console.log): void {
  const { tool, country, city, metal, latency_ms, error_code } = entry;
  write(JSON.stringify({ event: "usage", tool, country, city, metal, latency_ms, error_code }));
}
