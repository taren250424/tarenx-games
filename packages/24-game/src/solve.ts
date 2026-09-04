/*
 * Exact arithmetic and the search behind the 24 Game. Values are fractions so
 * that 8 ÷ (3 − 8 ÷ 3) comes out as exactly 24 rather than 23.999…, and the
 * search simply tries every way of merging two cards until one is left.
 *
 * This module is imported by the build-time grader as well as the game, so it
 * must stay free of anything Node cannot strip: no enums, no decorators.
 */

export interface Frac {
	n: number;
	d: number; // always positive; the fraction is kept reduced
}

export type Op = "+" | "−" | "×" | "÷";

export const OPS: Op[] = ["+", "−", "×", "÷"];

export const TARGET = 24;

function gcd(a: number, b: number): number {
	a = Math.abs(a);
	b = Math.abs(b);
	while (b) [a, b] = [b, a % b];
	return a;
}

export function frac(n: number, d = 1): Frac {
	if (d < 0) {
		n = -n;
		d = -d;
	}
	const g = gcd(n, d) || 1;
	return { n: n / g, d: d / g };
}

export function equals(a: Frac, b: Frac): boolean {
	return a.n === b.n && a.d === b.d;
}

export function isInteger(a: Frac): boolean {
	return a.d === 1;
}

/** "8/3" for a fraction, plain digits for a whole number. */
export function format(a: Frac): string {
	return isInteger(a) ? String(a.n) : `${a.n}/${a.d}`;
}

/** Returns null for division by zero. */
export function apply(a: Frac, op: Op, b: Frac): Frac | null {
	switch (op) {
		case "+":
			return frac(a.n * b.d + b.n * a.d, a.d * b.d);
		case "−":
			return frac(a.n * b.d - b.n * a.d, a.d * b.d);
		case "×":
			return frac(a.n * b.n, a.d * b.d);
		case "÷":
			return b.n === 0 ? null : frac(a.n * b.d, a.d * b.n);
	}
}

interface Card {
	value: Frac;
	expr: string;
	ints: boolean; // every value on the way here was a whole number
}

export interface Solution {
	expr: string;
	ints: boolean;
}

/*
 * Every distinct way of reaching 24 from these cards. Sums and products are
 * written with their operands in a fixed order so that 3 × 8 and 8 × 3 count
 * once; different bracketings of the same sum still count separately, which
 * is close enough for grading.
 */
export function solutions(values: Frac[]): Solution[] {
	const found = new Map<string, boolean>();

	const search = (cards: Card[]) => {
		if (cards.length === 1) {
			if (equals(cards[0].value, frac(TARGET))) {
				const { expr, ints } = cards[0];
				found.set(expr, (found.get(expr) ?? false) || ints);
			}
			return;
		}
		for (let i = 0; i < cards.length; i++) {
			for (let j = 0; j < cards.length; j++) {
				if (i === j) continue;
				const a = cards[i];
				const b = cards[j];
				const rest = cards.filter((_, k) => k !== i && k !== j);
				for (const op of OPS) {
					// commutative ops are generated once, in a fixed operand order
					if ((op === "+" || op === "×") && a.expr > b.expr) continue;
					const value = apply(a.value, op, b.value);
					if (!value) continue;
					search([
						...rest,
						{ value, expr: `(${a.expr} ${op} ${b.expr})`, ints: a.ints && b.ints && isInteger(value) },
					]);
				}
			}
		}
	};

	search(values.map((value) => ({ value, expr: format(value), ints: isInteger(value) })));
	return [...found].map(([expr, ints]) => ({ expr: expr.slice(1, -1), ints }));
}

export function solvable(values: Frac[]): boolean {
	return solutions(values).length > 0;
}

export interface Step {
	i: number;
	j: number;
	op: Op;
}

/*
 * One merge that keeps 24 reachable, for the hint button. Merges whose result
 * is a whole number come first, since those are the ones a player would think
 * of; returns null when the cards on the table can no longer make 24.
 */
export function nextStep(values: Frac[]): Step | null {
	const steps: Step[] = [];
	for (let i = 0; i < values.length; i++) {
		for (let j = 0; j < values.length; j++) {
			if (i === j) continue;
			for (const op of OPS) {
				const value = apply(values[i], op, values[j]);
				if (!value) continue;
				const rest = values.filter((_, k) => k !== i && k !== j);
				if (solvable([...rest, value])) steps.push({ i, j, op });
			}
		}
	}
	if (!steps.length) return null;
	const whole = steps.filter((s) => isInteger(apply(values[s.i], s.op, values[s.j]) as Frac));
	return (whole.length ? whole : steps)[0];
}
