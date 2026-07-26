import "./style.css";

const htmlFiles = import.meta.glob("../../*/index.html", {
	eager: true,
	query: "?raw",
	import: "default",
}) as Record<string, string>;

const games = Object.entries(htmlFiles)
	.map(([path, content]) => {
		// Vite resolves hub's index.html as '../index.html', others as '../../app/index.html'
		const parts = path.split("/");
		const folderName = parts[parts.length - 2];
		const dirName = folderName === ".." ? "hub" : folderName;

		// extract title from HTML content
		const titleMatch = content.match(/<title>(.*?)<\/title>/);
		const name = titleMatch ? titleMatch[1] : dirName;

		// extract description from HTML content
		const descMatch = content.match(
			/<meta\s+name="description"\s+content="([^"]*)"/
		);
		const description = descMatch ? descMatch[1] : "";

		return {
			name,
			description,
			icon: `shared/${dirName}/logo.svg`,
			href: `/${dirName}/`,
		};
	})
	.filter((game) => {
		const dirName = game.href.replace(/\//g, "");
		return dirName !== "hub" && dirName !== "shared";
	});

function main() {
	const main = document.querySelector("main") as HTMLElement;
	main.innerHTML = games
		.map(
			(game) => `
        <a href="${game.href}">
          <img src="${game.icon}" alt="${game.name}" />
          <span class="game-name">${game.name}</span>
          <span class="game-desc">${game.description}</span>
        </a>
      `
		)
		.join("");
}

document.addEventListener("DOMContentLoaded", main);
