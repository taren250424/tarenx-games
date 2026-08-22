// SVG chess board: squares, coordinates, highlights, pieces, arrows and a
// promotion picker. Move legality comes from chess.js; the board only knows
// how to show a position and let the side to move pick one legal move.
//
// Geometry: the viewBox is 360×360, one square is 45 units, which is the box
// the piece symbols are drawn in, so a piece is placed with a plain translate.

import { Chess, type Move, type Square, type Color, type PieceSymbol } from "chess.js";
import { pieceId, type PieceType } from "./pieces.ts";

export const SQ = 45;
const NS = "http://www.w3.org/2000/svg";
const FILES = "abcdefgh";
// Keep in sync with the .piece transition in style.css.
const MOVE_MS = 160;

export interface UserMove {
	from: Square;
	to: Square;
	promotion?: "q" | "r" | "b" | "n";
}

export interface Arrow {
	from: Square;
	to: Square;
	cls: string;
}

export interface PositionOptions {
	orientation: Color;
	lastMove?: [Square, Square] | null;
	interactive: boolean;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
	const el = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
	return el;
}

export class Board {
	private chess = new Chess();
	private orientation: Color = "w";
	private interactive = false;
	private lastMove: [Square, Square] | null = null;
	private selected: Square | null = null;
	private legal: Move[] = [];
	private onMove: ((m: UserMove) => void) | null = null;
	private pieceEls = new Map<Square, SVGUseElement>();
	private drag: { sq: Square; el: SVGUseElement; moved: boolean; pointerId: number } | null = null;
	private pendingPromo: { from: Square; to: Square } | null = null;

	private readonly squaresG: SVGGElement;
	private readonly hlG: SVGGElement;
	private readonly coordsG: SVGGElement;
	private readonly dotsG: SVGGElement;
	private readonly piecesG: SVGGElement;
	private readonly arrowsG: SVGGElement;

	constructor(
		private readonly svg: SVGSVGElement,
		private readonly promoEl: HTMLElement
	) {
		const defs = svgEl("defs");
		defs.innerHTML =
			'<radialGradient id="check-glow"><stop offset="0%" stop-color="#ef4444" stop-opacity="0.9"/>' +
			'<stop offset="55%" stop-color="#ef4444" stop-opacity="0.45"/><stop offset="100%" stop-color="#ef4444" stop-opacity="0"/></radialGradient>';
		svg.appendChild(defs);
		this.squaresG = svgEl("g", { class: "squares" });
		this.hlG = svgEl("g", { class: "highlights" });
		this.coordsG = svgEl("g", { class: "coords" });
		this.dotsG = svgEl("g", { class: "dots" });
		this.piecesG = svgEl("g", { class: "pieces" });
		this.arrowsG = svgEl("g", { class: "arrows" });
		svg.append(this.squaresG, this.hlG, this.coordsG, this.dotsG, this.piecesG, this.arrowsG);

		for (let f = 0; f < 8; f++) {
			for (let r = 0; r < 8; r++) {
				const sq = (FILES[f] + (r + 1)) as Square;
				const rect = svgEl("rect", {
					width: SQ,
					height: SQ,
					class: `sq ${(f + r) % 2 ? "light" : "dark"}`,
					"data-sq": sq,
				});
				this.squaresG.appendChild(rect);
			}
		}
		this.layoutSquares();

		svg.addEventListener("pointerdown", (e) => this.onPointerDown(e));
		svg.addEventListener("pointermove", (e) => this.onPointerMove(e));
		svg.addEventListener("pointerup", (e) => this.onPointerUp(e));
		svg.addEventListener("pointercancel", () => this.cancelDrag());
	}

	// --- public API ---

	setMoveHandler(fn: (m: UserMove) => void): void {
		this.onMove = fn;
	}

	setPosition(fen: string, opts: PositionOptions): void {
		this.chess.load(fen);
		this.orientation = opts.orientation;
		this.interactive = opts.interactive;
		this.lastMove = opts.lastMove ?? null;
		this.selected = null;
		this.legal = this.chess.moves({ verbose: true });
		this.cancelDrag();
		this.hidePromo();
		this.layoutSquares();
		this.renderPieces();
		this.renderHighlights();
		this.clearDots();
		this.clearArrows();
		this.svg.classList.toggle("locked", !this.interactive);
	}

	setInteractive(on: boolean): void {
		this.interactive = on;
		this.selected = null;
		this.clearDots();
		this.svg.classList.toggle("locked", !on);
	}

	fen(): string {
		return this.chess.fen();
	}

	turn(): Color {
		return this.chess.turn();
	}

	/** Apply a move to the shown position, animating the moving piece(s). */
	playMove(m: UserMove, opts: { asLastMove?: boolean } = {}): Move | null {
		let move: Move;
		try {
			move = this.chess.move({ from: m.from, to: m.to, promotion: m.promotion });
		} catch {
			return null;
		}
		this.legal = this.chess.moves({ verbose: true });
		this.selected = null;
		this.clearDots();
		if (opts.asLastMove !== false) this.lastMove = [move.from, move.to];

		// captured piece disappears at once (en passant captures off-square)
		if (move.isEnPassant()) {
			const capSq = (move.to[0] + move.from[1]) as Square;
			this.removePieceEl(capSq);
		} else if (move.isCapture()) {
			this.removePieceEl(move.to);
		}
		// slide the piece, then settle by re-rendering from the real position
		const el = this.pieceEls.get(move.from);
		if (el) {
			this.pieceEls.delete(move.from);
			this.pieceEls.set(move.to, el);
			this.place(el, move.to);
		}
		if (move.isKingsideCastle() || move.isQueensideCastle()) {
			const rank = move.from[1];
			const rookFrom = ((move.isKingsideCastle() ? "h" : "a") + rank) as Square;
			const rookTo = ((move.isKingsideCastle() ? "f" : "d") + rank) as Square;
			const rook = this.pieceEls.get(rookFrom);
			if (rook) {
				this.pieceEls.delete(rookFrom);
				this.pieceEls.set(rookTo, rook);
				this.place(rook, rookTo);
			}
		}
		window.setTimeout(() => {
			this.renderPieces();
			this.renderHighlights();
		}, MOVE_MS + 20);
		this.renderHighlights();
		return move;
	}

	setArrows(arrows: Arrow[]): void {
		this.clearArrows();
		for (const a of arrows) this.arrowsG.appendChild(this.arrowPath(a));
	}

	clearArrows(): void {
		this.arrowsG.replaceChildren();
	}

	// --- geometry ---

	private xy(sq: Square): [number, number] {
		const f = FILES.indexOf(sq[0]);
		const r = Number(sq[1]) - 1;
		return this.orientation === "w" ? [f * SQ, (7 - r) * SQ] : [(7 - f) * SQ, r * SQ];
	}

	private squareAt(clientX: number, clientY: number): Square | null {
		const rect = this.svg.getBoundingClientRect();
		const x = ((clientX - rect.left) / rect.width) * 360;
		const y = ((clientY - rect.top) / rect.height) * 360;
		if (x < 0 || y < 0 || x >= 360 || y >= 360) return null;
		let f = Math.floor(x / SQ);
		let r = 7 - Math.floor(y / SQ);
		if (this.orientation === "b") {
			f = 7 - f;
			r = 7 - r;
		}
		return (FILES[f] + (r + 1)) as Square;
	}

	private layoutSquares(): void {
		for (const rect of this.squaresG.children) {
			const sq = rect.getAttribute("data-sq") as Square;
			const [x, y] = this.xy(sq);
			rect.setAttribute("x", String(x));
			rect.setAttribute("y", String(y));
		}
		// coordinates: files along the bottom edge, ranks along the left edge
		this.coordsG.replaceChildren();
		for (let i = 0; i < 8; i++) {
			const fileIdx = this.orientation === "w" ? i : 7 - i;
			const rankIdx = this.orientation === "w" ? 7 - i : i;
			const fileSqLight = (fileIdx + 0 + (this.orientation === "w" ? 0 : 7)) % 2 === 1;
			const fileText = svgEl("text", {
				x: i * SQ + SQ - 3,
				y: 360 - 3,
				"text-anchor": "end",
				class: `coord ${fileSqLight ? "on-light" : "on-dark"}`,
			});
			fileText.textContent = FILES[fileIdx];
			const rankSqLight = ((this.orientation === "w" ? 0 : 7) + rankIdx) % 2 === 1;
			const rankText = svgEl("text", {
				x: 3,
				y: i * SQ + 11,
				class: `coord ${rankSqLight ? "on-light" : "on-dark"}`,
			});
			rankText.textContent = String(rankIdx + 1);
			this.coordsG.append(fileText, rankText);
		}
	}

	private place(el: SVGUseElement, sq: Square): void {
		const [x, y] = this.xy(sq);
		el.style.transform = `translate(${x}px, ${y}px)`;
	}

	// --- rendering ---

	private renderPieces(): void {
		this.piecesG.replaceChildren();
		this.pieceEls.clear();
		const turn = this.chess.turn();
		for (const row of this.chess.board()) {
			for (const cell of row) {
				if (!cell) continue;
				const use = svgEl("use", { width: SQ, height: SQ, class: "piece" });
				use.setAttribute("href", `#${pieceId(cell.color, cell.type.toUpperCase() as PieceType)}`);
				use.dataset.sq = cell.square;
				if (cell.color !== turn) use.classList.add("idle");
				// no transition on first paint: set transform before attaching
				use.style.transition = "none";
				this.place(use, cell.square);
				this.piecesG.appendChild(use);
				this.pieceEls.set(cell.square, use);
				// next frame re-enables the slide transition for later moves
				requestAnimationFrame(() => {
					use.style.transition = "";
				});
			}
		}
	}

	private removePieceEl(sq: Square): void {
		const el = this.pieceEls.get(sq);
		if (el) {
			el.remove();
			this.pieceEls.delete(sq);
		}
	}

	private renderHighlights(): void {
		this.hlG.replaceChildren();
		if (this.lastMove) {
			for (const sq of this.lastMove) this.hlG.appendChild(this.hlRect(sq, "hl-last"));
		}
		if (this.selected) this.hlG.appendChild(this.hlRect(this.selected, "hl-selected"));
		if (this.chess.inCheck()) {
			const king = this.findKing(this.chess.turn());
			if (king) this.hlG.appendChild(this.hlRect(king, "hl-check"));
		}
	}

	private hlRect(sq: Square, cls: string): SVGRectElement {
		const [x, y] = this.xy(sq);
		return svgEl("rect", { x, y, width: SQ, height: SQ, class: cls });
	}

	private findKing(color: Color): Square | null {
		for (const row of this.chess.board()) {
			for (const cell of row) {
				if (cell && cell.type === "k" && cell.color === color) return cell.square;
			}
		}
		return null;
	}

	private showDots(from: Square): void {
		this.clearDots();
		for (const m of this.legal) {
			if (m.from !== from) continue;
			const [x, y] = this.xy(m.to);
			const isCapture = m.isCapture() || m.isEnPassant();
			this.dotsG.appendChild(
				svgEl("circle", {
					cx: x + SQ / 2,
					cy: y + SQ / 2,
					r: isCapture ? SQ / 2 - 4 : 7,
					class: `dot${isCapture ? " capture" : ""}`,
				})
			);
		}
	}

	private clearDots(): void {
		this.dotsG.replaceChildren();
	}

	private arrowPath(a: Arrow): SVGPathElement {
		const [fx, fy] = this.xy(a.from);
		const [tx, ty] = this.xy(a.to);
		const x1 = fx + SQ / 2;
		const y1 = fy + SQ / 2;
		const x2 = tx + SQ / 2;
		const y2 = ty + SQ / 2;
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len = Math.hypot(dx, dy);
		const ux = dx / len;
		const uy = dy / len;
		const px = -uy;
		const py = ux;
		const w = 5; // half shaft width
		const head = 16;
		const hw = 12; // half head width
		const start = 8; // leave the centre of the from-square visible
		const sx = x1 + ux * start;
		const sy = y1 + uy * start;
		const bx = x2 - ux * head;
		const by = y2 - uy * head;
		const d = [
			`M${sx + px * w} ${sy + py * w}`,
			`L${bx + px * w} ${by + py * w}`,
			`L${bx + px * hw} ${by + py * hw}`,
			`L${x2} ${y2}`,
			`L${bx - px * hw} ${by - py * hw}`,
			`L${bx - px * w} ${by - py * w}`,
			`L${sx - px * w} ${sy - py * w}`,
			"Z",
		].join(" ");
		return svgEl("path", { d, class: `arrow ${a.cls}` });
	}

	// --- interaction ---

	private onPointerDown(e: PointerEvent): void {
		if (!this.interactive || this.pendingPromo) return;
		if (e.button !== 0) return;
		const sq = this.squareAt(e.clientX, e.clientY);
		if (!sq) return;

		// a selected piece plus a legal target → move
		if (this.selected && this.selected !== sq && this.isLegalTarget(this.selected, sq)) {
			this.tryMove(this.selected, sq);
			return;
		}

		const piece = this.chess.get(sq);
		if (piece && piece.color === this.chess.turn()) {
			this.selected = sq;
			this.renderHighlights();
			this.showDots(sq);
			const el = this.pieceEls.get(sq);
			if (el) {
				this.drag = { sq, el, moved: false, pointerId: e.pointerId };
				this.svg.setPointerCapture(e.pointerId);
			}
			e.preventDefault();
		} else {
			this.selected = null;
			this.renderHighlights();
			this.clearDots();
		}
	}

	private onPointerMove(e: PointerEvent): void {
		if (!this.drag) return;
		const rect = this.svg.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * 360 - SQ / 2;
		const y = ((e.clientY - rect.top) / rect.height) * 360 - SQ / 2;
		if (!this.drag.moved) {
			this.drag.moved = true;
			this.drag.el.classList.add("dragging");
			this.drag.el.style.transition = "none";
			this.piecesG.appendChild(this.drag.el); // on top while dragging
		}
		this.drag.el.style.transform = `translate(${x}px, ${y}px)`;
	}

	private onPointerUp(e: PointerEvent): void {
		if (!this.drag) return;
		const { sq, el, moved } = this.drag;
		this.drag = null;
		if (!moved) return; // plain click: stay selected, wait for the target click
		el.classList.remove("dragging");
		const target = this.squareAt(e.clientX, e.clientY);
		if (target && target !== sq && this.isLegalTarget(sq, target)) {
			this.place(el, target); // snap under the pointer; playMove re-renders
			requestAnimationFrame(() => {
				el.style.transition = "";
			});
			this.tryMove(sq, target);
		} else {
			this.place(el, sq);
			requestAnimationFrame(() => {
				el.style.transition = "";
			});
			if (target !== sq) {
				this.selected = null;
				this.renderHighlights();
				this.clearDots();
			}
		}
	}

	private cancelDrag(): void {
		if (!this.drag) return;
		const { sq, el } = this.drag;
		this.drag = null;
		el.classList.remove("dragging");
		this.place(el, sq);
		el.style.transition = "";
	}

	private isLegalTarget(from: Square, to: Square): boolean {
		return this.legal.some((m) => m.from === from && m.to === to);
	}

	private tryMove(from: Square, to: Square): void {
		const candidates = this.legal.filter((m) => m.from === from && m.to === to);
		if (candidates.length === 0) return;
		if (candidates[0].promotion) {
			this.askPromotion(from, to);
			return;
		}
		this.selected = null;
		this.clearDots();
		this.onMove?.({ from, to });
	}

	private askPromotion(from: Square, to: Square): void {
		this.pendingPromo = { from, to };
		this.clearDots();
		const color = this.chess.turn();
		const [x, y] = this.xy(to);
		const order: PieceSymbol[] = ["q", "r", "b", "n"];
		this.promoEl.replaceChildren();
		for (const p of order) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.title = { q: "Queen", r: "Rook", b: "Bishop", n: "Knight" }[p as "q" | "r" | "b" | "n"];
			btn.innerHTML = `<svg viewBox="0 0 45 45"><use href="#${pieceId(color, p.toUpperCase() as PieceType)}"/></svg>`;
			btn.addEventListener("click", () => {
				this.hidePromo();
				this.selected = null;
				this.onMove?.({ from, to, promotion: p as "q" | "r" | "b" | "n" });
			});
			this.promoEl.appendChild(btn);
		}
		// the picker hangs from the promotion square towards the board centre
		const pct = (v: number) => `${(v / 360) * 100}%`;
		this.promoEl.style.width = pct(SQ);
		this.promoEl.style.left = pct(x);
		if (y < 180) {
			this.promoEl.style.top = pct(y);
			this.promoEl.style.bottom = "";
			this.promoEl.style.flexDirection = "column";
		} else {
			this.promoEl.style.top = "";
			this.promoEl.style.bottom = pct(360 - y - SQ);
			this.promoEl.style.flexDirection = "column-reverse";
		}
		this.promoEl.classList.remove("hidden");
	}

	private hidePromo(): void {
		this.pendingPromo = null;
		this.promoEl.classList.add("hidden");
		this.promoEl.replaceChildren();
	}
}
