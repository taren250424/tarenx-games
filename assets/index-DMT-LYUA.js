(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=Object.entries(Object.assign({"../../blockdrop/index.html":`<!doctype html>
<html lang="en">
	<head>
    <!-- Google Tag Manager -->
    <script>
      (function (w, d, s, l, i) {
        w[l] = w[l] || [];
        w[l].push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
        var f = d.getElementsByTagName(s)[0],
          j = d.createElement(s),
          dl = l != "dataLayer" ? "&l=" + l : "";
        j.async = true;
        j.src = "https://www.googletagmanager.com/gtm.js?id=" + i + dl;
        f.parentNode.insertBefore(j, f);
      })(window, document, "script", "dataLayer", "GTM-NLCK842B");
    <\/script>
    <!-- End Google Tag Manager -->

		<meta charset="UTF-8" />
		<meta
			name="description"
			content="Play Block Drop free in your browser — stack falling blocks, clear lines, and chase your high score. Ghost piece, hold queue, and 7-bag randomizer included."
		/>

		<link rel="canonical" href="https://games.tarenx.com/blockdrop/" />
		<link rel="icon" type="image/svg+xml" href="shared/blockdrop/favicon.svg" />

		<meta property="og:title" content="Block Drop" />
		<meta
			property="og:description"
			content="Stack falling blocks, clear lines, chase the high score. Free browser puzzle game."
		/>
		<meta property="og:image" content="shared/blockdrop/og.svg" />

		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Block Drop</title>
	</head>

	<body>
    <!-- Google Tag Manager (noscript) -->
    <noscript
      ><iframe
        src="https://www.googletagmanager.com/ns.html?id=GTM-NLCK842B"
        height="0"
        width="0"
        style="display: none; visibility: hidden"
      ></iframe
    ></noscript>
    <!-- End Google Tag Manager (noscript) -->

		<header>
			<div class="header-brand">
				<img class="header-logo" src="shared/blockdrop/logo.svg" alt="Block Drop Logo" />
				<span class="header-title">Block Drop</span>
			</div>
			<a class="header-home" href="/">← All games</a>
		</header>

		<main>
			<aside class="ad"></aside>
			<section class="game-column">
			<div class="game-layout">
				<div class="side-panel">
					<div class="panel">
						<h3>Hold</h3>
						<canvas id="hold"></canvas>
					</div>
					<div class="panel">
						<h3>Score</h3>
						<strong id="score">0</strong>
					</div>
					<div class="panel">
						<h3>Best</h3>
						<strong id="high">0</strong>
					</div>
				</div>

				<div class="board-wrap">
					<canvas id="game"></canvas>
					<div id="overlay">
						<h2 id="overlay-title">Block Drop</h2>
						<p id="overlay-text">Press Enter or tap to start</p>
					</div>
				</div>

				<div class="side-panel">
					<div class="panel">
						<h3>Next</h3>
						<canvas id="next"></canvas>
					</div>
					<div class="panel">
						<h3>Lines</h3>
						<strong id="lines">0</strong>
					</div>
					<div class="panel">
						<h3>Level</h3>
						<strong id="level">1</strong>
					</div>
					<button id="sound-btn" class="panel" title="Toggle sound">🔊</button>
				</div>
			</div>

			<div class="touch-controls" aria-label="Touch controls">
				<button data-action="left" aria-label="Move left">◀</button>
				<button data-action="right" aria-label="Move right">▶</button>
				<button data-action="rotate" aria-label="Rotate">⟳</button>
				<button data-action="down" aria-label="Soft drop">▼</button>
				<button data-action="drop" aria-label="Hard drop">⤓</button>
				<button data-action="hold" aria-label="Hold">H</button>
			</div>

			<article>
				<section>
					<h2>How to play</h2>
					<p>
						Blocks of four squares fall into the well one at a time. Slide and
						rotate each one so it lands without gaps — when a horizontal row is
						completely filled it clears, everything above drops down, and you
						score points. The stack rises as you misplace pieces; when it
						reaches the top, the game ends. Speed increases every 10 lines, so
						the real game is staying tidy under pressure.
					</p>
				</section>

				<section>
					<h2>Controls</h2>
					<ul>
						<li><kbd>←</kbd> <kbd>→</kbd> — move left / right</li>
						<li><kbd>↑</kbd> or <kbd>X</kbd> — rotate</li>
						<li><kbd>↓</kbd> — soft drop (+1 point per cell)</li>
						<li><kbd>Space</kbd> — hard drop (+2 points per cell)</li>
						<li><kbd>C</kbd> or <kbd>Shift</kbd> — hold the current piece</li>
						<li><kbd>P</kbd> — pause · <kbd>R</kbd> — restart</li>
						<li>On touch screens: use the on-screen buttons below the well</li>
					</ul>
				</section>

				<section>
					<h2>Scoring</h2>
					<table>
						<tr><th>Lines cleared</th><th>Points</th></tr>
						<tr><td>Single</td><td>100 × level</td></tr>
						<tr><td>Double</td><td>300 × level</td></tr>
						<tr><td>Triple</td><td>500 × level</td></tr>
						<tr><td>Quad</td><td>800 × level</td></tr>
					</table>
				</section>

				<section>
					<h2>Tips</h2>
					<ul>
						<li>
							<strong>Keep the stack flat.</strong> A jagged surface forces bad
							placements. Aim to leave at most one deep column — ideally the
							edge — for the long I-piece.
						</li>
						<li>
							<strong>Watch the ghost.</strong> The outlined ghost piece shows
							exactly where the current piece will land; trust it for hard
							drops. It disappears at level 5 — use the early levels to build
							a feel for landing spots.
						</li>
						<li>
							<strong>Use hold strategically.</strong> Stash an I-piece for the
							moment your well column is four rows deep, and swap out pieces
							that don't fit the current surface.
						</li>
						<li>
							<strong>Quads pay best.</strong> 800 × level for a quad versus
							400 for four singles — building for four-line clears is more than
							twice the score, but don't let the stack get dangerously tall
							at high speed.
						</li>
					</ul>
				</section>
			</article>
			</section>
			<aside class="ad"></aside>
		</main>

		<footer>
			<p>
				Part of <a href="/">Tarenx Games</a> · free browser games, no install,
				no sign-up
			</p>
		</footer>

		<script type="module" src="/src/main.ts"><\/script>
	</body>
</html>
`,"../index.html":`<!doctype html>
<html lang="en">
	<head>
		<!-- Google Tag Manager -->
		<script>
			(function (w, d, s, l, i) {
				w[l] = w[l] || [];
				w[l].push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
				var f = d.getElementsByTagName(s)[0],
					j = d.createElement(s),
					dl = l != "dataLayer" ? "&l=" + l : "";
				j.async = true;
				j.src = "https://www.googletagmanager.com/gtm.js?id=" + i + dl;
				f.parentNode.insertBefore(j, f);
			})(window, document, "script", "dataLayer", "GTM-NLCK842B");
		<\/script>
		<!-- End Google Tag Manager -->

		<meta charset="UTF-8" />

		<meta
			name="description"
			content="Free browser games to play instantly. Sokoban, Block Drop, and more — no install, no sign-up."
		/>

		<link rel="canonical" href="https://games.tarenx.com/" />
		<link rel="icon" type="image/svg+xml" href="shared/hub/favicon.svg" />

		<meta property="og:title" content="Tarenx Games" />
		<meta
			property="og:description"
			content="Free browser games to play instantly. No install, no sign-up."
		/>
		<meta property="og:image" content="shared/hub/og.svg" />

		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Tarenx Games</title>
	</head>
	<body>
		<!-- Google Tag Manager (noscript) -->
		<noscript
			><iframe
				src="https://www.googletagmanager.com/ns.html?id=GTM-NLCK842B"
				height="0"
				width="0"
				style="display: none; visibility: hidden"
			></iframe
		></noscript>
		<!-- End Google Tag Manager (noscript) -->

		<header>
			<h1>Tarenx Games</h1>
			<p class="tagline">Free browser games. No install, no sign-up.</p>
		</header>
		<main></main>
		<footer>
		</footer>
		<script type="module" src="/src/main.ts"><\/script>
	</body>
</html>
`,"../../minesweeper/index.html":`<!doctype html>
<html lang="en">
	<head>
    <!-- Google Tag Manager -->
    <script>
      (function (w, d, s, l, i) {
        w[l] = w[l] || [];
        w[l].push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
        var f = d.getElementsByTagName(s)[0],
          j = d.createElement(s),
          dl = l != "dataLayer" ? "&l=" + l : "";
        j.async = true;
        j.src = "https://www.googletagmanager.com/gtm.js?id=" + i + dl;
        f.parentNode.insertBefore(j, f);
      })(window, document, "script", "dataLayer", "GTM-NLCK842B");
    <\/script>
    <!-- End Google Tag Manager -->

		<meta charset="UTF-8" />
		<meta
			name="description"
			content="Play Minesweeper free in your browser. Random boards on three sizes, safe first click, flags, and chording — clear the field without hitting a mine."
		/>

		<link rel="canonical" href="https://games.tarenx.com/minesweeper/" />
		<link rel="icon" type="image/svg+xml" href="shared/minesweeper/favicon.svg" />

		<meta property="og:title" content="Minesweeper" />
		<meta
			property="og:description"
			content="Clear the field without hitting a mine. Free classic puzzle with three board sizes."
		/>
		<meta property="og:image" content="shared/minesweeper/og.svg" />

		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Minesweeper</title>
	</head>

	<body>
    <!-- Google Tag Manager (noscript) -->
    <noscript
      ><iframe
        src="https://www.googletagmanager.com/ns.html?id=GTM-NLCK842B"
        height="0"
        width="0"
        style="display: none; visibility: hidden"
      ></iframe
    ></noscript>
    <!-- End Google Tag Manager (noscript) -->

		<header>
			<div class="header-brand">
				<img class="header-logo" src="shared/minesweeper/logo.svg" alt="Minesweeper Logo" />
				<span class="header-title">Minesweeper</span>
			</div>
			<a class="header-home" href="/">← All games</a>
		</header>

		<main>
			<aside class="ad"></aside>
			<section class="game-column">
			<div class="controls">
				<select id="difficulty-select" aria-label="Select board size"></select>
				<button id="new-btn" title="New game (R)">⟳ New Game</button>
				<button id="flag-btn" title="Flag mode (F)" aria-pressed="false">🚩 Flag</button>
				<button id="sound-btn" title="Toggle sound">🔊</button>
			</div>

			<div class="hud">
				<span>Mines <strong id="mines">0</strong></span>
				<span>Time <strong id="time">0:00</strong></span>
				<span>Best <strong id="best">—</strong></span>
			</div>

			<div class="board-wrap">
				<div id="board" aria-label="Minesweeper board"></div>
				<div id="end-overlay" class="hidden">
					<h2 id="end-title">Field Cleared!</h2>
					<p id="end-stats"></p>
					<button id="again-btn">Play Again</button>
				</div>
			</div>

			<article>
				<section>
					<h2>How to play</h2>
					<p>
						The board hides a number of mines. Open a square: if it's a mine,
						the game is over; otherwise it shows how many mines touch that
						square (diagonals included). Use those numbers to work out where
						the mines are, flag them, and open every safe square to clear the
						field. Boards are randomly generated every game, and your first
						click is always safe — it never lands on a mine.
					</p>
				</section>

				<section>
					<h2>Controls</h2>
					<ul>
						<li>Click / tap — open a square</li>
						<li>Right-click — place or remove a flag</li>
						<li>
							<kbd>F</kbd> or the 🚩 button — flag mode: taps place flags
							instead of opening (handy on touch screens)
						</li>
						<li>
							Click an open number that already has the right amount of flags
							around it — opens all its remaining neighbors at once (chording)
						</li>
						<li><kbd>R</kbd> — new game</li>
					</ul>
				</section>

				<section>
					<h2>Board sizes</h2>
					<table>
						<tr><th>Difficulty</th><th>Board</th><th>Mines</th></tr>
						<tr><td>Beginner</td><td>9 × 9</td><td>10</td></tr>
						<tr><td>Intermediate</td><td>16 × 16</td><td>40</td></tr>
						<tr><td>Expert</td><td>30 × 16</td><td>99</td></tr>
					</table>
				</section>

				<section>
					<h2>Tips</h2>
					<ul>
						<li>
							<strong>Start from the open areas.</strong> Big empty regions
							reveal themselves in one click; the numbers along their border
							are where the real deductions begin.
						</li>
						<li>
							<strong>Learn the 1-2-1 and 1-2-2-1 patterns.</strong> Along a
							straight wall, 1-2-1 means the mines sit under the 1s' outer
							neighbors, and 1-2-2-1 puts them under the 2s. Spotting these
							saves a lot of second-guessing.
						</li>
						<li>
							<strong>A satisfied number is information.</strong> When a
							number already touches the right amount of flags, every other
							neighbor is safe — chord it and move on.
						</li>
						<li>
							<strong>Flag sparingly.</strong> On easy boards it's often
							faster to only flag where it helps a chord; every extra flag is
							a chance for a wrong one.
						</li>
					</ul>
				</section>

				<section>
					<h2>About Minesweeper</h2>
					<p>
						Minesweeper became a household puzzle when it shipped with
						Windows 3.1 in 1992, but its logic-of-adjacent-counts idea goes
						back to 1960s mainframe games. It has been studied seriously
						since: deciding whether a Minesweeper position is consistent is
						NP-complete, which is why some endgames genuinely come down to a
						guess. This version uses the classic three board sizes and a
						guaranteed-safe first click.
					</p>
				</section>
			</article>
			</section>
			<aside class="ad"></aside>
		</main>

		<footer>
			<p>
				Part of <a href="/">Tarenx Games</a> · free browser games, no install,
				no sign-up
			</p>
		</footer>

		<script type="module" src="/src/main.ts"><\/script>
	</body>
</html>
`,"../../sokoban/index.html":`<!doctype html>
<html lang="en">
	<head>
    <!-- Google Tag Manager -->
    <script>
      (function (w, d, s, l, i) {
        w[l] = w[l] || [];
        w[l].push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
        var f = d.getElementsByTagName(s)[0],
          j = d.createElement(s),
          dl = l != "dataLayer" ? "&l=" + l : "";
        j.async = true;
        j.src = "https://www.googletagmanager.com/gtm.js?id=" + i + dl;
        f.parentNode.insertBefore(j, f);
      })(window, document, "script", "dataLayer", "GTM-NLCK842B");
    <\/script>
    <!-- End Google Tag Manager -->

		<meta charset="UTF-8" />
		<meta
			name="description"
			content="Play Sokoban free in your browser. 173 puzzle levels — a hand-crafted starter set plus the classic Microban collection — with unlimited undo."
		/>

		<link rel="canonical" href="https://games.tarenx.com/sokoban/" />
		<link rel="icon" type="image/svg+xml" href="shared/sokoban/favicon.svg" />

		<meta property="og:title" content="Sokoban" />
		<meta
			property="og:description"
			content="Push every crate onto its goal. Free classic puzzle with 173 levels and unlimited undo."
		/>
		<meta property="og:image" content="shared/sokoban/og.svg" />

		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Sokoban</title>
	</head>

	<body>
    <!-- Google Tag Manager (noscript) -->
    <noscript
      ><iframe
        src="https://www.googletagmanager.com/ns.html?id=GTM-NLCK842B"
        height="0"
        width="0"
        style="display: none; visibility: hidden"
      ></iframe
    ></noscript>
    <!-- End Google Tag Manager (noscript) -->

		<header>
			<div class="header-brand">
				<img class="header-logo" src="shared/sokoban/logo.svg" alt="Sokoban Logo" />
				<span class="header-title">Sokoban</span>
			</div>
			<a class="header-home" href="/">← All games</a>
		</header>

		<main>
			<aside class="ad"></aside>
			<section class="game-column">
			<div class="controls">
				<select id="level-select" aria-label="Select level"></select>
				<button id="undo-btn" title="Undo (Z)">↩ Undo</button>
				<button id="restart-btn" title="Restart (R)">⟳ Restart</button>
				<button id="sound-btn" title="Toggle sound">🔊</button>
			</div>

			<div class="hud">
				<span>Moves <strong id="moves">0</strong></span>
				<span>Pushes <strong id="pushes">0</strong></span>
				<span>Best <strong id="best">—</strong></span>
			</div>

			<div class="board-wrap">
				<div id="board" aria-label="Sokoban board"></div>
				<div id="win-overlay" class="hidden">
					<h2>Level Complete!</h2>
					<p id="win-stats"></p>
					<button id="next-btn">Next Level →</button>
				</div>
			</div>

			<div class="dpad" aria-label="Touch controls">
				<button data-dir="up" aria-label="Move up">▲</button>
				<button data-dir="left" aria-label="Move left">◀</button>
				<button data-dir="down" aria-label="Move down">▼</button>
				<button data-dir="right" aria-label="Move right">▶</button>
			</div>

			<article>
				<section>
					<h2>How to play</h2>
					<p>
						You are the warehouse keeper. Push every crate onto a goal spot
						(the dashed circles) to complete the level. Crates can only be
						<em>pushed</em>, never pulled — and you can push just one crate at a
						time. A crate shoved into a corner is stuck for good, so plan each
						push before you make it. Finished crates turn green.
					</p>
				</section>

				<section>
					<h2>Controls</h2>
					<ul>
						<li><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> — move</li>
						<li><kbd>Z</kbd> or <kbd>U</kbd> — undo (unlimited)</li>
						<li><kbd>R</kbd> — restart level</li>
						<li>On touch screens: swipe the board or use the on-screen arrows</li>
					</ul>
				</section>

				<section>
					<h2>Strategy tips</h2>
					<ul>
						<li>
							<strong>Watch the corners.</strong> A crate pushed into a corner
							(or against a wall with no goal along it) can never be recovered.
							Learn to spot these dead squares before pushing.
						</li>
						<li>
							<strong>Order matters.</strong> Many levels have only one working
							order for the crates. If a crate blocks the path you need for
							another, solve the far crate first.
						</li>
						<li>
							<strong>Think in pushes, not steps.</strong> Walking is free —
							what counts is where you stand <em>before</em> each push. Ask
							"can I get behind the crate?" rather than "can I reach the
							crate?".
						</li>
						<li>
							<strong>Use undo freely.</strong> Experimenting is part of the
							game. Undo is unlimited, so try a line of pushes and roll back if
							it dead-ends.
						</li>
					</ul>
				</section>

				<section>
					<h2>About Sokoban</h2>
					<p>
						Sokoban (倉庫番, "warehouse keeper") was created in Japan in the
						early 1980s and has become one of the most studied puzzle games
						ever — solving arbitrary Sokoban levels is PSPACE-complete, which
						is why even tiny boards can be surprisingly deep.
					</p>
					<p>
						Two collections are included. The <strong>Starter Set</strong> (18
						levels) was created for Tarenx Games and arranged from a gentle
						first push to multi-crate warehouses.
						<strong>Microban</strong> (155 levels) is the beloved
						beginner-friendly collection by David W. Skinner, included here
						with attribution as the author intended — thank you, David. Level
						transcriptions are machine-verified with a Sokoban solver.
					</p>
				</section>
			</article>
			</section>
			<aside class="ad"></aside>
		</main>

		<footer>
			<p>
				Part of <a href="/">Tarenx Games</a> · free browser games, no install,
				no sign-up
			</p>
		</footer>

		<script type="module" src="/src/main.ts"><\/script>
	</body>
</html>
`,"../../sudoku/index.html":`<!doctype html>
<html lang="en">
	<head>
    <!-- Google Tag Manager -->
    <script>
      (function (w, d, s, l, i) {
        w[l] = w[l] || [];
        w[l].push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
        var f = d.getElementsByTagName(s)[0],
          j = d.createElement(s),
          dl = l != "dataLayer" ? "&l=" + l : "";
        j.async = true;
        j.src = "https://www.googletagmanager.com/gtm.js?id=" + i + dl;
        f.parentNode.insertBefore(j, f);
      })(window, document, "script", "dataLayer", "GTM-NLCK842B");
    <\/script>
    <!-- End Google Tag Manager -->

		<meta charset="UTF-8" />
		<meta
			name="description"
			content="Play Sudoku free in your browser. 300 handpicked puzzles across three difficulties — every one solvable by pure logic, with notes, hints, and unlimited undo."
		/>

		<link rel="canonical" href="https://games.tarenx.com/sudoku/" />
		<link rel="icon" type="image/svg+xml" href="shared/sudoku/favicon.svg" />

		<meta property="og:title" content="Sudoku" />
		<meta
			property="og:description"
			content="Fill every row, column, and box with 1–9. Free classic puzzle with 300 logic-solvable boards."
		/>
		<meta property="og:image" content="shared/sudoku/og.svg" />

		<meta name="viewport" content="width=device-width, initial-scale=1.0" />
		<title>Sudoku</title>
	</head>

	<body>
    <!-- Google Tag Manager (noscript) -->
    <noscript
      ><iframe
        src="https://www.googletagmanager.com/ns.html?id=GTM-NLCK842B"
        height="0"
        width="0"
        style="display: none; visibility: hidden"
      ></iframe
    ></noscript>
    <!-- End Google Tag Manager (noscript) -->

		<header>
			<div class="header-brand">
				<img class="header-logo" src="shared/sudoku/logo.svg" alt="Sudoku Logo" />
				<span class="header-title">Sudoku</span>
			</div>
			<a class="header-home" href="/">← All games</a>
		</header>

		<main>
			<aside class="ad"></aside>
			<section class="game-column">
			<div class="controls">
				<select id="puzzle-select" aria-label="Select puzzle"></select>
				<button id="restart-btn" title="Restart (R)">⟳ Restart</button>
				<label class="check-label" title="Highlight digits that don't match the solution">
					<input type="checkbox" id="mistakes-check" checked /> Show mistakes
				</label>
				<button id="sound-btn" title="Toggle sound">🔊</button>
			</div>

			<div class="hud">
				<span>Time <strong id="time">0:00</strong></span>
				<span>Best <strong id="best">—</strong></span>
				<span>Hints <strong id="hints">3</strong></span>
			</div>

			<div class="board-wrap">
				<div id="board" aria-label="Sudoku board"></div>
				<div id="win-overlay" class="hidden">
					<h2>Puzzle Complete!</h2>
					<p id="win-stats"></p>
					<button id="next-btn">Next Puzzle →</button>
				</div>
			</div>

			<div class="toolbar" aria-label="Tools">
				<button id="undo-btn" title="Undo (Z)">↩ Undo</button>
				<button id="erase-btn" title="Erase (Delete)">⌫ Erase</button>
				<button id="notes-btn" title="Notes (N)" aria-pressed="false">✎ Notes</button>
				<button id="hint-btn" title="Hint (H)">💡 Hint</button>
			</div>

			<div class="numpad" aria-label="Number pad"></div>

			<article>
				<section>
					<h2>How to play</h2>
					<p>
						Fill the 9×9 grid so that every row, every column, and every 3×3
						box contains the digits 1 through 9 exactly once. Each puzzle
						starts with some digits already given — those are fixed. Tap a
						cell, then tap a number to fill it in. Every puzzle here has
						exactly one solution, and none of them ever require guessing:
						careful logic is always enough.
					</p>
				</section>

				<section>
					<h2>Controls</h2>
					<ul>
						<li>Click or tap a cell, then a number — or type <kbd>1</kbd>–<kbd>9</kbd> directly</li>
						<li><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> — move between cells</li>
						<li><kbd>N</kbd> — toggle notes (pencil marks)</li>
						<li><kbd>Z</kbd> or <kbd>U</kbd> — undo (unlimited)</li>
						<li><kbd>Delete</kbd>, <kbd>Backspace</kbd> or <kbd>0</kbd> — erase a cell</li>
						<li><kbd>H</kbd> — use a hint (3 per puzzle)</li>
						<li><kbd>R</kbd> — restart the puzzle</li>
					</ul>
				</section>

				<section>
					<h2>Strategy tips</h2>
					<ul>
						<li>
							<strong>Scan for singles first.</strong> Look for cells where
							only one digit can go, and for digits that fit only one spot in
							a row, column, or box. Easy puzzles fall entirely to this.
						</li>
						<li>
							<strong>Use notes aggressively.</strong> Pencil in every
							candidate for the tricky regions. Most mid-game logic — pairs,
							locked candidates — only becomes visible once the notes are
							down.
						</li>
						<li>
							<strong>Look for locked candidates.</strong> If a digit's only
							spots in a box all sit on one row, that digit can be ruled out
							of the rest of the row — a medium-level workhorse.
						</li>
						<li>
							<strong>Never guess.</strong> Every puzzle here is graded by the
							techniques it needs and is solvable by logic alone. If you're
							stuck, there is always a deduction you haven't spotted yet.
						</li>
					</ul>
				</section>

				<section>
					<h2>About Sudoku</h2>
					<p>
						The modern 9×9 Sudoku was popularized in Japan in the 1980s under
						the name 数独 ("single digits") and became a worldwide phenomenon
						in the 2000s. Behind the simple rules sits real depth: valid grids
						number in the sextillions, and at least 17 given digits are needed
						for a puzzle to have a unique solution.
					</p>
					<p>
						This edition ships 300 puzzles — 100 each of Easy, Medium, and
						Hard. Every board is generated with a guaranteed unique solution,
						then graded by the human solving techniques it requires: Easy
						puzzles fall to singles alone, Medium needs locked candidates and
						pairs, and Hard calls for triples and X-wings. Nothing ever
						requires trial and error.
					</p>
				</section>
			</article>
			</section>
			<aside class="ad"></aside>
		</main>

		<footer>
			<p>
				Part of <a href="/">Tarenx Games</a> · free browser games, no install,
				no sign-up
			</p>
		</footer>

		<script type="module" src="/src/main.ts"><\/script>
	</body>
</html>
`})).map(([e,t])=>{let n=e.split(`/`),r=n[n.length-2],i=r===`..`?`hub`:r,a=t.match(/<title>(.*?)<\/title>/),o=a?a[1]:i,s=t.match(/<meta\s+name="description"\s+content="([^"]*)"/);return{name:o,description:s?s[1]:``,icon:`shared/${i}/logo.svg`,href:`/${i}/`}}).filter(e=>{let t=e.href.replace(/\//g,``);return t!==`hub`&&t!==`shared`});function t(){let t=document.querySelector(`main`);t.innerHTML=e.map(e=>`
        <a href="${e.href}">
          <span class="game-brand">
            <img src="${e.icon}" alt="${e.name}" />
            <span class="game-name">${e.name}</span>
          </span>
          <span class="game-desc">${e.description}</span>
        </a>
      `).join(``)}document.addEventListener(`DOMContentLoaded`,t);