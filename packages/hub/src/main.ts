import "./style.css";

// The game list is prerendered into index.html at build time by the
// prerender-game-list plugin in vite.config.ts. This only wires the
// category chips: a chip hides every card outside its category, and the
// cards stay in the document either way so crawlers see all of them.

const chips = [...document.querySelectorAll<HTMLButtonElement>(".chip")];
const cards = [...document.querySelectorAll<HTMLAnchorElement>(".card")];

function show(filter: string): void {
	for (const chip of chips) {
		chip.setAttribute("aria-pressed", String(chip.dataset.filter === filter));
	}
	for (const card of cards) {
		card.hidden = filter !== "all" && card.dataset.category !== filter;
	}
}

for (const chip of chips) {
	chip.addEventListener("click", () => show(chip.dataset.filter ?? "all"));
}
