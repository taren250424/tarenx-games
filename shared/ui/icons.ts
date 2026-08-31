/*
 * Line icons for the controls, drawn in the current text colour so they sit
 * in a button like a glyph would — where the colour emoji used to be.
 *
 * Usage
 *   Markup: `<i data-icon="dice"></i> Random`, then `mountIcons()` once the
 *   DOM is there. Script: `icon("flag")` returns the SVG markup for innerHTML.
 *   `setSoundIcon(btn, on)` swaps the speaker on the sound toggle.
 */

const PATHS: Record<string, string> = {
	sound: '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
	"sound-off": '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/>',
	dice:
		'<rect x="3" y="3" width="18" height="18" rx="4"/>' +
		'<g fill="currentColor" stroke="none"><circle cx="8" cy="8" r="1.4"/><circle cx="16" cy="8" r="1.4"/>' +
		'<circle cx="12" cy="12" r="1.4"/><circle cx="8" cy="16" r="1.4"/><circle cx="16" cy="16" r="1.4"/></g>',
	bulb:
		'<path d="M9 18h6M10 21h4"/>' +
		'<path d="M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.5 1 2.5h6c0-1 .4-1.9 1-2.5A6 6 0 0 0 12 3z"/>',
	chart: '<path d="M4 20v-8M10 20V5M16 20v-6M2 20h20"/>',
	flag: '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>',
	eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
	mine:
		'<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>' +
		'<path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3"/>',
	cross: '<path d="M6 6l12 12M18 6 6 18"/>',
};

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = "icon"): string {
	return (
		`<svg class="${className}" viewBox="0 0 24 24" width="1em" height="1em" fill="none" ` +
		`stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
		`${PATHS[name]}</svg>`
	);
}

/** Replaces every `<i data-icon="…">` placeholder under `root` with its SVG. */
export function mountIcons(root: ParentNode = document): void {
	for (const el of root.querySelectorAll<HTMLElement>("i[data-icon]")) {
		el.outerHTML = icon(el.dataset.icon as IconName);
	}
}

export function setSoundIcon(btn: HTMLElement, on: boolean): void {
	btn.innerHTML = icon(on ? "sound" : "sound-off");
	btn.setAttribute("aria-label", on ? "Sound on" : "Sound off");
}
