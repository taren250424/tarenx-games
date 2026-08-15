// Shared sound-effect player. Each game keeps its clips in public/audio/ and
// owns its own enabled flag (persisted per game); this module only handles
// loading and playback.
export function createSfx<T extends string>(
	names: readonly T[],
	isEnabled: () => boolean,
	ext = "wav"
): (name: T) => void {
	const sounds = Object.fromEntries(
		names.map((name) => [name, new Audio(`${import.meta.env.BASE_URL}audio/${name}.${ext}`)])
	) as Record<T, HTMLAudioElement>;

	return (name) => {
		if (!isEnabled()) return;
		const audio = sounds[name];
		audio.currentTime = 0;
		audio.play().catch(() => {
			// autoplay blocked before first interaction — ignore
		});
	};
}
