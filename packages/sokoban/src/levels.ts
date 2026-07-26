// Original level set for tarenx games — every level verified solvable
// with a push-based BFS solver before inclusion.
// Legend: # wall, @ player, $ box, . goal, * box on goal, + player on goal
import { MICROBAN } from "./microban.ts";

export interface Level {
	name: string;
	rows: string[];
}

export interface Collection {
	id: string;
	name: string;
	credit?: string;
	levels: Level[];
}

export const LEVELS: Level[] = [
	{
		name: "First Push",
		rows: ["######", "#    #", "# @$.#", "#    #", "######"],
	},
	{
		name: "Around the Corner",
		rows: ["#####", "#.  #", "# $ #", "# @ #", "#####"],
	},
	{
		name: "Two at Once",
		rows: ["#######", "#     #", "# @$. #", "# $   #", "# .   #", "#######"],
	},
	{
		name: "Side by Side",
		rows: [
			"########",
			"#      #",
			"# $$   #",
			"# .@.  #",
			"#      #",
			"########",
		],
	},
	{
		name: "Crossing Paths",
		rows: ["#######", "#  .  #", "# $$. #", "#  @  #", "#######"],
	},
	{
		name: "The Hook",
		rows: ["#######", "#     #", "# ##  #", "# # $ #", "# #.$.#", "#@    #", "#######"],
	},
	{
		name: "Pinwheel",
		rows: [
			"#######",
			"#  .  #",
			"# .$. #",
			"# $@$ #",
			"#  $  #",
			"#  .  #",
			"#######",
		],
	},
	{
		name: "Storage Room",
		rows: ["#######", "#. .  #", "#  $$ #", "# @   #", "#######"],
	},
	{
		name: "Plus Room",
		rows: [
			"########",
			"#  .   #",
			"# #$#  #",
			"#.$@$ .#",
			"# #$#  #",
			"#  .   #",
			"########",
		],
	},
	{
		name: "Tight Squeeze",
		rows: ["######", "#.  ##", "#$#  #", "# $  #", "#. @ #", "######"],
	},
	{
		name: "Loopback",
		rows: [
			"#########",
			"##  #   #",
			"#  $#.$ #",
			"#   .   #",
			"#  ##  ##",
			"#   $ . #",
			"## @   ##",
			"#########",
		],
	},
	{
		name: "Four Corners",
		rows: [
			"#########",
			"#   #   #",
			"# $ . $ #",
			"# . @ . #",
			"# $ . $ #",
			"#   #   #",
			"#########",
		],
	},
	{
		name: "Triple Trouble",
		rows: ["#######", "# .   #", "# $$# #", "#. $ .#", "#   @ #", "#######"],
	},
	{
		name: "Loading Dock",
		rows: [
			"########",
			"# .  . #",
			"# $##$ #",
			"#  ..  #",
			"# $$   #",
			"#  @   #",
			"########",
		],
	},
	{
		name: "The Ledge",
		rows: [
			"########",
			"#      #",
			"#  ### #",
			"# @$   #",
			"#  ###.#",
			"#.  $  #",
			"########",
		],
	},
	{
		name: "Twin Lanes",
		rows: [
			"########",
			"#   #  #",
			"# $   .#",
			"# @    #",
			"# $   .#",
			"#   #  #",
			"########",
		],
	},
	{
		name: "The Warehouse",
		rows: [
			"########",
			"#  #   #",
			"# $#$  #",
			"# .  . #",
			"# $ #  #",
			"# .# @ #",
			"########",
		],
	},
	{
		name: "The Chamber",
		rows: [
			"########",
			"#      #",
			"# ## # #",
			"# $  $ #",
			"# #  # #",
			"# . .@ #",
			"########",
		],
	},
];

export const COLLECTIONS: Collection[] = [
	{
		id: "starter",
		name: "Starter Set",
		levels: LEVELS,
	},
	{
		id: "microban",
		name: "Microban",
		credit: "David W. Skinner",
		levels: MICROBAN,
	},
];
