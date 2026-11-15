import type { SpotProvider } from "../rates/types";
import { spacing } from "./upstream";

export const REFRESH_GAP_MS = 500;

// refreshAll asks both spot providers at once, so one gate spaces every call of a refresh.
export function spaced(providers: readonly [SpotProvider, SpotProvider], gapMs: number): readonly [SpotProvider, SpotProvider] {
  const gate = spacing(gapMs);
  const gated = (provider: SpotProvider): SpotProvider => ({
    source: provider.source,
    fetchSpot: (metal) => gate(() => provider.fetchSpot(metal)),
  });
  return [gated(providers[0]), gated(providers[1])];
}
