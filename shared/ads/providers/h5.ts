import type { AdProvider, InterstitialResult, RewardedResult } from "../ads.ts";

// AdSense H5 Games Ads. The page's adsbygoogle.js tag (in every game's
// index.html, with data-ad-frequency-hint) turns the objects pushed here
// into ad breaks. If the script never runs — blocked, or the account has
// not been enabled for games — nothing ever calls back, so a break that
// has not started within GRACE_MS is treated as unavailable rather than
// leaving the game waiting.

type BreakStatus =
	| "notReady"
	| "timeout"
	| "invalid"
	| "error"
	| "noAdPreloaded"
	| "frequencyCapped"
	| "ignored"
	| "other"
	| "dismissed"
	| "viewed";

interface AdBreakDone {
	breakStatus: BreakStatus;
}

declare global {
	interface Window {
		adsbygoogle?: unknown[];
	}
}

const GRACE_MS = 1000;

let soundOn: () => boolean = () => true;

// Set once a break gets no reaction at all within the grace period: the
// script is not serving breaks on this page, so later calls answer at once
// instead of making the player wait again.
let dormant = false;

// A reward break is requested ahead of time; Google hands back showAdFn
// once an ad is ready, and the same break's callbacks report how the
// player left it after showAdFn runs.
let showReward: (() => void) | undefined;
let settleReward: ((result: RewardedResult) => void) | undefined;
let rewardRequested = false;

function queue(): unknown[] {
	return (window.adsbygoogle ??= []);
}

function requestReward(): void {
	if (rewardRequested) return;
	rewardRequested = true;
	let viewed = false;
	queue().push({
		type: "reward",
		name: "reward",
		beforeReward(showAdFn: () => void) {
			showReward = showAdFn;
		},
		adViewed() {
			viewed = true;
		},
		adDismissed() {
			settleReward?.("dismissed");
			settleReward = undefined;
		},
		adBreakDone() {
			settleReward?.(viewed ? "viewed" : "dismissed");
			settleReward = undefined;
			showReward = undefined;
			rewardRequested = false;
		},
	});
}

export const h5: AdProvider = {
	init({ sound }) {
		soundOn = sound;
		queue().push({ preloadAdBreaks: "on", sound: sound() ? "on" : "off" });
	},

	interstitial(placement, name): Promise<InterstitialResult> {
		if (dormant) return Promise.resolve("unavailable");
		return new Promise((resolve) => {
			let reacted = false;
			const grace = setTimeout(() => {
				if (reacted) return;
				dormant = true;
				resolve("unavailable");
			}, GRACE_MS);
			queue().push({ sound: soundOn() ? "on" : "off" });
			queue().push({
				type: placement,
				name,
				beforeAd() {
					reacted = true;
					clearTimeout(grace);
				},
				afterAd() {},
				adBreakDone({ breakStatus }: AdBreakDone) {
					reacted = true;
					clearTimeout(grace);
					resolve(breakStatus === "viewed" || breakStatus === "dismissed" ? "shown" : "unavailable");
				},
			});
		});
	},

	rewarded(): Promise<RewardedResult> {
		const show = showReward;
		if (!show) {
			requestReward();
			return Promise.resolve("unavailable");
		}
		showReward = undefined;
		return new Promise((resolve) => {
			settleReward = resolve;
			show();
		});
	},

	rewardedAvailable() {
		if (!showReward) requestReward();
		return showReward !== undefined;
	},
};
