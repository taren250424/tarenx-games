import "./style.css";
import { recentlyPlayed } from "../../shared/progress/recent.ts";

// The game list is prerendered into index.html at build time by the
// prerender-game-list plugin in vite.config.ts. This wires the category
// chips — a chip hides every card outside its category, and the cards stay
// in the document either way so crawlers see all of them — and builds the
// "Recently played" row from this browser's history.

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

const recent = recentlyPlayed()
	.map((dir) => cards.find((card) => card.getAttribute("href") === `/${dir}/`))
	.filter((card): card is HTMLAnchorElement => card !== undefined);

if (recent.length > 0) {
	const section = document.createElement("section");
	section.className = "recent";
	section.innerHTML = `<h2>Recently played</h2><div class="recent-row"></div>`;
	const row = section.querySelector(".recent-row")!;
	for (const card of recent) {
		const link = document.createElement("a");
		link.className = "recent-card";
		link.href = card.href;
		link.innerHTML = `<img src="${card.querySelector("img")!.getAttribute("src")}" alt="" width="36" height="36" /><span>${card.querySelector(".card-name")!.textContent}</span>`;
		row.append(link);
	}
	document.querySelector(".chips")!.before(section);
}
