/*
 * The card table: DOM, geometry and pointer handling for a solitaire game.
 *
 * It owns no rules. The game says where every card sits on each render and
 * answers four questions — can this be picked up, may it land here, it landed,
 * something was tapped — and the table takes care of the rest: building the
 * elements once, positioning them off a single card width so every move
 * animates for free, telling a click from a drag, and hit-testing the drop.
 *
 *   const table = createTable({ root, cards: orderedDeck(), slots, columns: 8, handlers })
 *   table.render((place) => {
 *     place(card, { slot: "tableau:0", dy: 0.28 * depth })
 *   })
 */

import { type Card, RANKS, SUITS, cardName, isRed, rank, suit } from "./deck.ts";
import "./table.css";

export interface SlotSpec {
	/** Addresses the slot in placements and drop handlers, e.g. "tableau:3". */
	id: string;
	/** Grid column, counted in card widths from the left of the table. */
	col: number;
	/** Top row (cells, foundations, stock) or the tableau below it. */
	row: "top" | "tableau";
	/** Drawn in the middle of the slot while it is empty. */
	glyph?: string;
	/** Stretch the drop zone to the bottom, so a pile can be dropped on anywhere. */
	tall?: boolean;
	/** Extra classes, for a game that wants to style one kind of slot. */
	className?: string;
}

export interface PlaceSpec {
	slot: string;
	/** Offset from the slot, in card widths / card heights. */
	dx?: number;
	dy?: number;
	faceDown?: boolean;
	/** Draws the card as pickable — the cursor changes, nothing more. */
	grabbable?: boolean;
	selected?: boolean;
}

export interface TableHit {
	/** The card under the pointer, or null if it landed on bare table. */
	card: Card | null;
	/** The slot under the pointer, or null. */
	slot: string | null;
}

export interface TableHandlers {
	/**
	 * A press landed on `card`. Return the cards that should travel with it,
	 * top card first, or null when it cannot be picked up.
	 */
	grab(card: Card): Card[] | null;
	/** Would this stack be allowed to land here? Drives the drop highlight. */
	canDrop(cards: Card[], slot: string): boolean;
	/** The stack was let go over `slot`, or over nothing. */
	drop(cards: Card[], slot: string | null): void;
	/** A press that never turned into a drag. */
	tap(hit: TableHit): void;
}

export interface TableOptions {
	root: HTMLElement;
	/** Face value per card element, in element order. */
	cards: Card[];
	slots: SlotSpec[];
	/** Width of the table, in card columns. */
	columns: number;
	/** Floor for the tableau height, in card heights. */
	minRows?: number;
	handlers: TableHandlers;
}

export interface CardTable {
	/** Repositions every card. Cards left unplaced are hidden. */
	render(draw: (place: (card: Card, spec: PlaceSpec) => void) => void): void;
	/** Lets the table shrink back to its floor — call when a new game is dealt. */
	reset(): void;
	/** Turns pointer input off while an animation plays or the game is over. */
	setEnabled(enabled: boolean): void;
	element(card: Card): HTMLElement;
}

const DRAG_THRESHOLD = 5;

export function createTable(options: TableOptions): CardTable {
	const { root, cards, slots, columns, handlers } = options;
	const minRows = options.minRows ?? 3.8;

	root.classList.add("card-table");
	root.style.setProperty("--columns", String(columns));

	const slotsEl = document.createElement("div");
	slotsEl.className = "card-slots";
	slotsEl.setAttribute("aria-hidden", "true");
	const cardsEl = document.createElement("div");
	cardsEl.className = "card-layer";
	root.append(slotsEl, cardsEl);

	// --- slots ---
	const slotById = new Map<string, SlotSpec>();
	const slotEls = new Map<string, HTMLElement>();
	for (const slot of slots) {
		slotById.set(slot.id, slot);
		const el = document.createElement("div");
		el.className = `card-slot row-${slot.row}${slot.tall ? " tall" : ""}${slot.className ? ` ${slot.className}` : ""}`;
		el.dataset.drop = slot.id;
		el.style.setProperty("--cx", String(slot.col));
		if (slot.glyph) el.textContent = slot.glyph;
		slotEls.set(slot.id, el);
		slotsEl.append(el);
	}

	// --- cards ---
	// One element per card, built once and then only ever repositioned, so the
	// browser animates every move without the game asking it to.
	const cardEls = new Map<Card, HTMLElement>();
	for (const card of cards) {
		const corner = `<b>${RANKS[rank(card)]}</b><i>${SUITS[suit(card)]}</i>`;
		const el = document.createElement("div");
		el.className = "card";
		el.dataset.card = String(card);
		el.setAttribute("aria-label", cardName(card));
		el.innerHTML =
			`<span class="card-face">` +
			`<span class="corner tl">${corner}</span>` +
			`<span class="pip">${SUITS[suit(card)]}</span>` +
			`<span class="corner br">${corner}</span>` +
			`</span><span class="card-back"></span>`;
		cardEls.set(card, el);
		cardsEl.append(el);
	}

	// --- rendering ---
	let rows = minRows;
	const placed = new Set<Card>();

	function render(draw: (place: (card: Card, spec: PlaceSpec) => void) => void) {
		placed.clear();
		const filled = new Set<string>();
		let order = 0;

		const place = (card: Card, spec: PlaceSpec) => {
			const el = cardEls.get(card);
			const slot = slotById.get(spec.slot);
			if (!el || !slot) return;
			const dx = spec.dx ?? 0;
			const dy = spec.dy ?? 0;

			el.className =
				`card row-${slot.row} ${isRed(card) ? "red" : "black"}` +
				`${spec.faceDown ? " down" : ""}` +
				`${spec.grabbable ? " grabbable" : ""}` +
				`${spec.selected ? " selected" : ""}`;
			el.style.setProperty("--cx", String(slot.col));
			el.style.setProperty("--ox", String(dx));
			el.style.setProperty("--oy", String(dy));
			el.style.removeProperty("--drag-x");
			el.style.removeProperty("--drag-y");
			el.style.zIndex = String(++order);

			filled.add(spec.slot);
			placed.add(card);
			// The table is as tall as its longest column, and only ever grows
			// within a game so the layout does not bounce as piles come and go.
			if (slot.row === "tableau") rows = Math.max(rows, dy + 1);
		};

		draw(place);

		for (const [card, el] of cardEls) el.classList.toggle("gone", !placed.has(card));
		for (const [id, el] of slotEls) el.classList.toggle("filled", filled.has(id));
		root.style.setProperty("--rows", rows.toFixed(2));
	}

	function reset() {
		rows = minRows;
	}

	// --- pointer ---
	/*
	 * A press is only known to be a click or a drag once the pointer has moved
	 * (or not), so both live in one pipeline. Nothing listens for `click`, which
	 * keeps a drag that ends where it started from also counting as a tap.
	 */
	interface Press {
		pointerId: number;
		cards: Card[];
		hit: TableHit;
		startX: number;
		startY: number;
		dragging: boolean;
	}

	let press: Press | null = null;
	let highlighted: HTMLElement | null = null;
	let enabled = true;

	function hitAt(x: number, y: number): TableHit {
		const el = document.elementFromPoint(x, y) as HTMLElement | null;
		const cardEl = el?.closest<HTMLElement>(".card");
		const slotEl = el?.closest<HTMLElement>("[data-drop]");
		return {
			card: cardEl ? Number(cardEl.dataset.card) : null,
			slot: slotEl ? String(slotEl.dataset.drop) : null,
		};
	}

	function highlight(slot: string | null) {
		const el = slot ? slotEls.get(slot) ?? null : null;
		if (highlighted === el) return;
		highlighted?.classList.remove("target");
		highlighted = el;
		highlighted?.classList.add("target");
	}

	root.addEventListener("pointerdown", (e) => {
		if (!enabled || press) return;
		e.preventDefault();
		const el = e.target as HTMLElement;
		const cardEl = el.closest<HTMLElement>(".card");
		const slotEl = el.closest<HTMLElement>("[data-drop]");
		const card = cardEl ? Number(cardEl.dataset.card) : null;
		press = {
			pointerId: e.pointerId,
			cards: card === null ? [] : handlers.grab(card) ?? [],
			hit: { card, slot: slotEl ? String(slotEl.dataset.drop) : null },
			startX: e.clientX,
			startY: e.clientY,
			dragging: false,
		};
		root.setPointerCapture(e.pointerId);
	});

	root.addEventListener("pointermove", (e) => {
		if (!press || e.pointerId !== press.pointerId || !press.cards.length) return;
		const dx = e.clientX - press.startX;
		const dy = e.clientY - press.startY;
		if (!press.dragging) {
			if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
			press.dragging = true;
			cardsEl.classList.add("dragging");
			press.cards.forEach((card, i) => {
				const el = cardEls.get(card);
				if (!el) return;
				el.classList.add("dragging");
				el.style.zIndex = String(900 + i);
			});
		}
		for (const card of press.cards) {
			const el = cardEls.get(card);
			if (!el) continue;
			el.style.setProperty("--drag-x", `${dx}px`);
			el.style.setProperty("--drag-y", `${dy}px`);
		}
		const over = hitAt(e.clientX, e.clientY).slot;
		highlight(over && handlers.canDrop(press.cards, over) ? over : null);
	});

	function endPress(e: PointerEvent, cancelled: boolean) {
		if (!press || e.pointerId !== press.pointerId) return;
		const p = press;
		press = null;
		if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);

		if (!p.dragging) {
			if (!cancelled && enabled) handlers.tap(p.hit);
			return;
		}
		// Hit-test while the card layer is still transparent to the pointer: the
		// cards in hand sit right under the cursor and would answer first.
		const target = cancelled ? null : hitAt(e.clientX, e.clientY).slot;
		cardsEl.classList.remove("dragging");
		for (const card of p.cards) cardEls.get(card)?.classList.remove("dragging");
		highlight(null);
		handlers.drop(p.cards, target);
	}

	root.addEventListener("pointerup", (e) => endPress(e, false));
	root.addEventListener("pointercancel", (e) => endPress(e, true));
	root.addEventListener("contextmenu", (e) => e.preventDefault());

	return {
		render,
		reset,
		setEnabled(value: boolean) {
			enabled = value;
		},
		element(card: Card) {
			return cardEls.get(card) as HTMLElement;
		},
	};
}
