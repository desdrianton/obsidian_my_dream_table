import type { TableModel } from "../model/TableModel";
import type { CellRef, Range } from "../model/types";

/**
 * Cells as tab-separated text, the format spreadsheets copy and paste.
 * Cells holding a tab, a line break or a leading quote are quoted, with
 * quotes doubled, like Excel and Google Sheets do.
 */
export function toTsv(cells: string[][]): string {
	return cells.map((row) => row.map(quoteField).join("\t")).join("\n");
}

function quoteField(value: string): string {
	return /[\t\n\r]|^"/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Splits tab-separated text into rows of cells, padded to the same width.
 * A field is read as quoted only if its closing quote ends it, so text
 * that merely starts with a quote is taken as it is.
 */
export function parseTsv(text: string): string[][] {
	const source = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
	const rows: string[][] = [[]];
	let pos = 0;
	for (;;) {
		const [value, next] = readField(source, pos);
		rows[rows.length - 1]!.push(value);
		if (next >= source.length) break;
		if (source[next] === "\n") rows.push([]);
		pos = next + 1;
	}
	const width = Math.max(...rows.map((row) => row.length));
	return rows.map((row) => [...row, ...Array<string>(width - row.length).fill("")]);
}

/** The field starting at `pos` and the index of the tab or line break after it. */
function readField(source: string, pos: number): [string, number] {
	if (source[pos] === '"') {
		let value = "";
		let i = pos + 1;
		while (i < source.length) {
			const quote = source.indexOf('"', i);
			if (quote === -1) break;
			value += source.slice(i, quote);
			if (source[quote + 1] === '"') {
				value += '"';
				i = quote + 2;
				continue;
			}
			const after = quote + 1;
			if (after >= source.length || source[after] === "\t" || source[after] === "\n") return [value, after];
			break;
		}
	}
	let end = pos;
	while (end < source.length && source[end] !== "\t" && source[end] !== "\n") end++;
	return [source.slice(pos, end), end];
}

/** The markdown of every cell in `range`; cells hidden under a merge are empty. */
export function copyCells(model: TableModel, range: Range): string[][] {
	const cells: string[][] = [];
	for (let row = range.top; row <= range.bottom; row++) {
		const line: string[] = [];
		for (let col = range.left; col <= range.right; col++) {
			line.push(model.isCovered(row, col) ? "" : model.getCell(row, col));
		}
		cells.push(line);
	}
	return cells;
}

/**
 * Writes `cells` with their top-left at `at`, adding rows and columns at
 * the end of the table when they do not fit (only columns while the table
 * is collapsed, so nothing lands in hidden rows). Cells hidden under a
 * merge are skipped. Returns the range written, grown to whole merges.
 */
export function pasteCells(model: TableModel, at: CellRef, cells: string[][]): Range {
	const width = cells[0]?.length ?? 0;
	const lastRow = at.row + cells.length - 1;
	const lastCol = at.col + width - 1;
	if (lastCol >= model.colCount) model.insertColumns(model.colCount, lastCol - model.colCount + 1);
	if (!model.collapsed && lastRow >= model.rowCount) model.insertRows(model.rowCount, lastRow - model.rowCount + 1);
	const bottom = Math.min(lastRow, model.visibleRowCount - 1);
	for (let row = at.row; row <= bottom; row++) {
		for (let col = at.col; col <= lastCol; col++) {
			if (!model.isCovered(row, col)) model.setCell(row, col, cells[row - at.row]![col - at.col]!);
		}
	}
	return model.expandToMerges({ top: at.row, left: at.col, bottom, right: lastCol });
}

/** Writes `value` into every cell of the ranges (a single copied cell pasted onto several). */
export function fillCells(model: TableModel, ranges: readonly Range[], value: string): void {
	for (const range of ranges) {
		for (let row = range.top; row <= range.bottom; row++) {
			for (let col = range.left; col <= range.right; col++) {
				if (!model.isCovered(row, col)) model.setCell(row, col, value);
			}
		}
	}
}

/**
 * Clipboard format carrying the copied cells as JSON, next to the plain
 * text. Pasting reads the cells from it rather than parsing the text, so a
 * cell holding a tab or a line break pastes as one cell.
 */
export const CELLS_FORMAT = "application/x-dream-table-cells";

/**
 * The last cells copied from any table, for when the clipboard drops
 * CELLS_FORMAT: pasting the same text back uses these instead of parsing
 * it, so a copied column of multi-line cells is not mistaken for a single
 * cell's text.
 */
let lastCopied: { text: string; cells: string[][] } | null = null;

/** Puts copied cells on the clipboard, as text and as CELLS_FORMAT. */
export function writeCells(data: DataTransfer, cells: string[][]): void {
	const text = cells.length === 1 && cells[0]!.length === 1 ? cells[0]![0]! : toTsv(cells);
	lastCopied = { text, cells };
	data.setData("text/plain", text);
	data.setData(CELLS_FORMAT, JSON.stringify(cells));
}

/** Pasted cells, and whether they came from a table (rather than another app). */
export function readCells(data: DataTransfer): { cells: string[][]; fromTable: boolean } {
	const cells = parseCells(data.getData(CELLS_FORMAT));
	if (cells) return { cells, fromTable: true };
	const text = data.getData("text/plain");
	if (lastCopied && lastCopied.text === text) return { cells: lastCopied.cells, fromTable: true };
	return { cells: parseTsv(text), fromTable: false };
}

/** CELLS_FORMAT data as cells, or null when it is missing or malformed. */
function parseCells(json: string): string[][] | null {
	if (!json) return null;
	try {
		const cells: unknown = JSON.parse(json);
		const valid =
			Array.isArray(cells) &&
			cells.length > 0 &&
			cells.every(
				(row) =>
					Array.isArray(row) &&
					row.length === (cells[0] as unknown[]).length &&
					row.every((cell) => typeof cell === "string"),
			);
		return valid && (cells[0] as unknown[]).length > 0 ? (cells as string[][]) : null;
	} catch {
		return null;
	}
}
