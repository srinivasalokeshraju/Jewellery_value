import type { SpotProvider } from "../rates/types";

export const REFRESH_GAP_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// gold-api.com bans clients that send several requests per second, and refreshAll asks both providers at once.
// The wait is checked against the clock, not trusted to the timer, because a Worker timer can fire a few ms early.
export function spaced(providers: readonly [SpotProvider, SpotProvider], gapMs: number): readonly [SpotProvider, SpotProvider] {
  let turn: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;
  const gate = (provider: SpotProvider): SpotProvider => ({
    source: provider.source,
    fetchSpot(metal) {
      const started = turn.then(async () => {
        for (let wait = lastStart + gapMs - Date.now(); wait > 0; wait = lastStart + gapMs - Date.now()) await sleep(wait);
        const call = provider.fetchSpot(metal);
        lastStart = Date.now();
        return { call };
      });
      turn = started.catch(() => undefined);
      return started.then(({ call }) => call);
    },
  });
  return [gate(providers[0]), gate(providers[1])];
}
