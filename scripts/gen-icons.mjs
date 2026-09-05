// Rasterises the hub logo into the PNG icons the web app manifest and iOS
// need, under packages/hub/public/icons/. The files are committed; re-run
// this script only when the logo changes.
//
//   node scripts/gen-icons.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGO = join(ROOT, "packages", "shared", "hub", "logo.svg");
const OUT = join(ROOT, "packages", "hub", "public", "icons");
const BACKGROUND = "#ffffff";

const logo = readFileSync(LOGO, "utf8");
const viewBox = logo.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 32 32";
const [, , logoW, logoH] = viewBox.split(/\s+/).map(Number);
const inner = logo.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

// The logo drawn at `scale` of the canvas, centred on a solid background.
// Maskable icons get cropped to a circle or squircle by the launcher, so
// the artwork keeps to the middle 80%; the others fill the canvas.
function render(size, scale) {
	const drawn = size * scale;
	const offset = (size - drawn) / 2;
	const k = drawn / Math.max(logoW, logoH);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
	<rect width="${size}" height="${size}" fill="${BACKGROUND}"/>
	<g transform="translate(${offset} ${offset}) scale(${k})">${inner}</g>
</svg>`;
	return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

const icons = [
	["icon-192.png", 192, 1],
	["icon-512.png", 512, 1],
	["maskable-512.png", 512, 0.8],
	["apple-touch-icon.png", 180, 1],
];

mkdirSync(OUT, { recursive: true });
for (const [name, size, scale] of icons) {
	writeFileSync(join(OUT, name), render(size, scale));
	console.log(`${name}  ${size}×${size}`);
}
