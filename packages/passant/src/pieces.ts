// Original chess piece set, drawn for this game. Every piece lives in a
// 45×45 box with its base on y≈39.5 and its axis on x=22.5. A piece is a list
// of filled outlines plus a few detail strokes; the detail strokes switch to a
// light colour on the dark pieces so they stay visible.
//
// pieceSprite() returns one <svg> holding a <symbol> per colour/piece, meant
// to be injected once into the document; the board then places pieces with
// <use href="#p-wK"> etc.

export type PieceType = "K" | "Q" | "R" | "B" | "N" | "P";
export type PieceColor = "w" | "b";

interface Shape {
	d: string;
	/** A detail stroke with no fill (eye, slit, bands). */
	line?: boolean;
	/** A filled shape that only appears on one colour (e.g. highlights). */
	only?: PieceColor;
}

const BASE = "M11.5 36.5h22a1.5 1.5 0 0 1 0 3h-22a1.5 1.5 0 0 1 0-3z";
const SKIRT = "M13.5 33h18l1.5 3.5h-21z";
const COLLAR = "M17 30h11l1 3h-13z";

const SHAPES: Record<PieceType, Shape[]> = {
	P: [
		{ d: BASE },
		{ d: SKIRT },
		{ d: "M17.5 21.5h10l2.5 11.5h-15z" },
		{ d: "M17 18.5h11a1.5 1.5 0 0 1 0 3h-11a1.5 1.5 0 0 1 0-3z" },
		{ d: "M22.5 7a5.5 5.5 0 1 1-.01 0z" },
	],
	R: [
		{ d: BASE },
		{ d: "M12.5 33h20l1 3.5h-22z" },
		{
			d: "M13 9h4.5v3h3.5v-3h3v3h3.5v-3h4.5v6l-2 2v14l2 2v1h-19v-1l2-2v-14l-2-2z",
		},
		{ d: "M15 17h15", line: true },
		{ d: "M15 31h15", line: true },
	],
	B: [
		{ d: BASE },
		{ d: SKIRT },
		{ d: COLLAR },
		{
			d: "M22.5 9c5 4 7.5 9 7.5 14 0 3.5-2 6-4 7h-7c-2-1-4-3.5-4-7 0-5 2.5-10 7.5-14z",
		},
		{ d: "M22.5 5.5a2.3 2.3 0 1 1-.01 0z" },
		{ d: "M23.5 16l4 5.5", line: true },
		{ d: "M16.5 26.5h12", line: true },
	],
	N: [
		{ d: BASE },
		{ d: "M12.5 33h20l1 3.5h-22z" },
		{
			// head faces left: back of the neck, ear, forehead, muzzle, jaw, chest
			d:
				"M32 33c0-7-1-15-7-20.5l-1.5-5-3.5 4.5c-4 1.5-8 6-9.5 10.5-.5 1.5.5 2.8 2 2.8h2.5l1.2-1.2c.5 1.5 1.5 2.5 2.8 2.8-1.5 2.5-3 5-3 6.6z",
		},
		{ d: "M18.8 15.8a1 1 0 1 1-.01 0z", line: true },
		{ d: "M13.2 21.7a.7.7 0 1 1-.01 0z", line: true },
		{ d: "M25 14.5c3 3 4.5 8 5 13", line: true },
	],
	Q: [
		{ d: BASE },
		{ d: SKIRT },
		{
			d: "M14.5 33l-2-15 5 6 .5-12.5 4.5 11.5 4.5-11.5.5 12.5 5-6-2 15z",
		},
		{ d: "M12.5 16.2a1.8 1.8 0 1 1-.01 0z" },
		{ d: "M18 9.7a1.8 1.8 0 1 1-.01 0z" },
		{ d: "M22.5 8a1.8 1.8 0 1 1-.01 0z" },
		{ d: "M27 9.7a1.8 1.8 0 1 1-.01 0z" },
		{ d: "M32.5 16.2a1.8 1.8 0 1 1-.01 0z" },
		{ d: "M14 27.5c5.5-2 11.5-2 17 0", line: true },
	],
	K: [
		{ d: BASE },
		{ d: SKIRT },
		{ d: "M21 6h3v3h3v3h-3v3h-3v-3h-3v-3h3z" },
		{
			d: "M16.5 33l-1.5-13c0-3.5 3-5 7.5-5s7.5 1.5 7.5 5l-1.5 13z",
		},
		{ d: "M15.5 24.5h14", line: true },
		{ d: "M15.8 27.5h13.4", line: true },
	],
};

const PALETTE: Record<PieceColor, { fill: string; stroke: string; detail: string }> = {
	w: { fill: "#f5f5f4", stroke: "#292524", detail: "#292524" },
	b: { fill: "#292524", stroke: "#1c1917", detail: "#d6d3d1" },
};

export function pieceId(color: PieceColor, type: PieceType): string {
	return `p-${color}${type}`;
}

export function pieceSprite(): string {
	const symbols: string[] = [];
	for (const color of ["w", "b"] as PieceColor[]) {
		const pal = PALETTE[color];
		for (const type of Object.keys(SHAPES) as PieceType[]) {
			const body = SHAPES[type]
				.filter((s) => !s.only || s.only === color)
				.map((s) =>
					s.line
						? `<path d="${s.d}" fill="none" stroke="${pal.detail}" stroke-width="1.4" stroke-linecap="round"/>`
						: `<path d="${s.d}" fill="${pal.fill}" stroke="${pal.stroke}" stroke-width="1.5" stroke-linejoin="round"/>`
				)
				.join("");
			symbols.push(`<symbol id="${pieceId(color, type)}" viewBox="0 0 45 45">${body}</symbol>`);
		}
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols.join("")}</svg>`;
}
