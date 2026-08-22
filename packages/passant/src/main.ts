import "../../shared/ads/ad-slot.css";
import "./style.css";
import { pieceSprite } from "./pieces.ts";
import { Board } from "./board.ts";

document.body.insertAdjacentHTML("afterbegin", pieceSprite());
const board = new Board(
	document.getElementById("board") as unknown as SVGSVGElement,
	document.getElementById("promo") as HTMLElement
);
board.setPosition("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", {
	orientation: "w",
	lastMove: ["g8", "f6"],
	interactive: true,
});
board.setMoveHandler((m) => {
	console.log("move", m);
	board.playMove(m);
});
board.setArrows([{ from: "h5", to: "f7", cls: "best" }]);
