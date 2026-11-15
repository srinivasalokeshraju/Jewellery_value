import type { SpotProvider } from "../rates/types";

export const REFRESH_GAP_MS = 500;

// gold-api.com bans clients that send several requests per second, and refreshAll asks both providers at once.
export function spaced(providers: readonly [SpotProvider, SpotProvider], gapMs: number): readonly [SpotProvider, SpotProvider] {
  let turn: Promise<void> = Promise.resolve();
  const wait = (): Promise<void> => {
    const mine = turn;
    turn = turn.then(() => new Promise((resolve) => setTimeout(resolve, gapMs)));
    return mine;
  };
  const gate = (provider: SpotProvider): SpotProvider => ({
    source: provider.source,
    async fetchSpot(metal) {
      await wait();
      return provider.fetchSpot(metal);
    },
  });
  return [gate(providers[0]), gate(providers[1])];
}
