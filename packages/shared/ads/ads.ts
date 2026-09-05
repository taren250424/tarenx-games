/*
 * The one door every game uses for ads. The provider behind it depends on
 * where the page runs (browser: AdSense H5 Games Ads; native app: AdMob;
 * development or nothing approved yet: none), and the policy below applies
 * whichever provider is behind it.
 *
 * Usage
 *   1. `ads.init({ sound: () => progress.settings.sound })` once on load.
 *   2. On the button that starts the next round — never when the end-of-game
 *      overlay appears, and never on page load or the first round:
 *        `await ads.interstitial("next", "<game>-next"); startNewRound();`
 *      The promise settles when the game may continue, whether an ad ran,
 *      was skipped, or none was available.
 *   3. Rewarded ads sit behind a button the player chooses to press — a
 *      hint, one solved cell, a solution replay:
 *        `if (await ads.rewarded("<game>-hint")) giveHint();`
 *      Show the offer only while `ads.rewardedAvailable()`.
 *
 * Every decision is pushed to the GTM dataLayer as
 *   { event: "ad", placement, name, status }
 * so the frequency and fill can be read off analytics.
 */

import { none } from "./providers/none.ts";

export type Placement = "next" | "pause" | "browse";
export type InterstitialResult = "shown" | "unavailable";
export type RewardedResult = "viewed" | "dismissed" | "unavailable";

export interface AdProvider {
	init(opts: { sound: () => boolean }): void;
	interstitial(placement: Placement, name: string): Promise<InterstitialResult>;
	rewarded(name: string): Promise<RewardedResult>;
	rewardedAvailable(): boolean;
}

declare global {
	interface Window {
		dataLayer?: unknown[];
	}
}

const MIN_INTERVAL_MS = 90_000;

const provider: AdProvider = none;

let roundsEnded = 0;
let lastShownAt = 0;
let busy = false;

function record(placement: string, name: string, status: string): void {
	(window.dataLayer ??= []).push({ event: "ad", placement, name, status });
	if (import.meta.env.DEV) console.debug(`[ads] ${placement} ${name}: ${status}`);
}

export const ads = {
	init(opts: { sound: () => boolean }): void {
		provider.init(opts);
	},

	async interstitial(placement: Placement, name: string): Promise<void> {
		roundsEnded += 1;
		let status: string;
		if (busy) {
			status = "skipped:busy";
		} else if (roundsEnded < 2) {
			status = "skipped:first-round";
		} else if (Date.now() - lastShownAt < MIN_INTERVAL_MS) {
			status = "skipped:interval";
		} else {
			busy = true;
			try {
				status = await provider.interstitial(placement, name);
			} finally {
				busy = false;
			}
			if (status === "shown") lastShownAt = Date.now();
		}
		record(placement, name, status);
	},

	async rewarded(name: string): Promise<boolean> {
		if (busy) {
			record("reward", name, "skipped:busy");
			return false;
		}
		busy = true;
		let status: RewardedResult;
		try {
			status = await provider.rewarded(name);
		} finally {
			busy = false;
		}
		record("reward", name, status);
		return status === "viewed";
	},

	rewardedAvailable(): boolean {
		return provider.rewardedAvailable();
	},
};
