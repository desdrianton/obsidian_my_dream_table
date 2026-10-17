import type { CellRef, Range } from "./types";

const CELL_REF_PATTERN = /^([A-Z]+)([1-9][0-9]*)$/;

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnToLetters(col: number): string {
	if (!Number.isInteger(col) || col < 0) {
		throw new RangeError(`Invalid column index: ${col}`);
	}
	let letters = "";
	let n = col + 1;
	while (n > 0) {
		const rem = (n - 1) % 26;
		letters = String.fromCharCode(65 + rem) + letters;
		n = Math.floor((n - 1) / 26);
	}
	return letters;
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26. */
export function lettersToColumn(letters: string): number {
	if (!/^[A-Z]+$/.test(letters)) {
		throw new SyntaxError(`Invalid column letters: "${letters}"`);
	}
	let n = 0;
	for (const ch of letters) {
		n = n * 26 + (ch.charCodeAt(0) - 64);
	}
	return n - 1;
}

/** Parses "B3" into { row: 2, col: 1 }. Case-insensitive. */
export function parseCellRef(ref: string): CellRef {
	const match = CELL_REF_PATTERN.exec(ref.trim().toUpperCase());
	if (!match) {
		throw new SyntaxError(`Invalid cell reference: "${ref}"`);
	}
	return { row: Number(match[2]) - 1, col: lettersToColumn(match[1]!) };
}

export function formatCellRef({ row, col }: CellRef): string {
	return `${columnToLetters(col)}${row + 1}`;
}

/**
 * Parses "A1:C2" (or a single cell "B3") into a normalized range, so "C2:A1"
 * yields the same result as "A1:C2".
 */
export function parseRange(text: string): Range {
	const parts = text.split(":");
	if (parts.length > 2) {
		throw new SyntaxError(`Invalid range: "${text}"`);
	}
	const a = parseCellRef(parts[0]!);
	const b = parts.length === 2 ? parseCellRef(parts[1]!) : a;
	return normalizeRange(a, b);
}

/** Single cells are written as "B3", larger ranges as "A1:C2". */
export function formatRange(range: Range): string {
	const start = formatCellRef({ row: range.top, col: range.left });
	if (range.top === range.bottom && range.left === range.right) {
		return start;
	}
	return `${start}:${formatCellRef({ row: range.bottom, col: range.right })}`;
}

export function normalizeRange(a: CellRef, b: CellRef): Range {
	return {
		top: Math.min(a.row, b.row),
		left: Math.min(a.col, b.col),
		bottom: Math.max(a.row, b.row),
		right: Math.max(a.col, b.col),
	};
}
