import type { AdProvider } from "../ads.ts";

// No ads at all: development, an account not yet approved, or a blocker.
// Every call settles at once so the game never waits on it.
export const none: AdProvider = {
	init() {},
	interstitial: () => Promise.resolve("unavailable"),
	rewarded: () => Promise.resolve("unavailable"),
	rewardedAvailable: () => false,
};
