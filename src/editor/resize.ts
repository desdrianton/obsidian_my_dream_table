import { DEFAULT_COLUMN_WIDTH } from "../render/renderTable";
import type { ColumnWidth } from "../model/types";

/** How close (px) to a cell border the pointer must be to grab it. */
export const RESIZE_GRAB_PX = 5;
/** Narrowest width (px) a column can be dragged to. */
export const MIN_DRAG_WIDTH = 40;

/**
 * Column whose right border is under the pointer, or null. A cell's right
 * edge ends its last spanned column; its left edge ends the previous column.
 */
export function hitColumnEdge(
	rect: { left: number; right: number },
	clientX: number,
	col: number,
	colSpan: number,
	grab = RESIZE_GRAB_PX,
): number | null {
	const width = rect.right - rect.left;
	// Not laid out (e.g. hidden): there is no border to grab.
	if (width <= 0) return null;
	// Keep the middle of narrow cells clickable for selection.
	const reach = Math.min(grab, width / 3);
	if (Math.abs(clientX - rect.right) <= reach) return col + colSpan - 1;
	if (col > 0 && Math.abs(clientX - rect.left) <= reach) return col - 1;
	return null;
}

/** Widths after dragging column `col`'s border by `dx` px. Other columns keep their width. */
export function resizedWidths(
	start: readonly number[],
	col: number,
	dx: number,
	min = MIN_DRAG_WIDTH,
): number[] {
	const widths = [...start];
	widths[col] = Math.max(min, Math.round(start[col]! + dx));
	return widths;
}

/**
 * Current rendered width of every column. Columns covered only by merged
 * cells get an equal share of the merge's width.
 */
export function measureColumnWidths(table: HTMLTableElement, colCount: number): number[] {
	const measured: (number | null)[] = Array(colCount).fill(null);
	const merged: HTMLTableCellElement[] = [];
	for (const td of Array.from(table.querySelectorAll<HTMLTableCellElement>("td[data-col]"))) {
		const col = Number(td.dataset.col);
		if (td.colSpan > 1) {
			merged.push(td);
		} else if (measured[col] === null) {
			measured[col] = td.getBoundingClientRect().width;
		}
	}
	// Narrow merges pin columns down most precisely, so they go first. Each
	// merge's width, minus the columns already known, is shared by the rest.
	merged.sort((a, b) => a.colSpan - b.colSpan);
	for (const td of merged) {
		const start = Number(td.dataset.col);
		const span = [];
		for (let col = start; col < start + td.colSpan && col < colCount; col++) span.push(col);
		const unknown = span.filter((col) => measured[col] === null);
		if (unknown.length === 0) continue;
		const known = span.reduce((sum, col) => sum + (measured[col] ?? 0), 0);
		const share = (td.getBoundingClientRect().width - known) / unknown.length;
		for (const col of unknown) measured[col] = share > 0 ? share : null;
	}
	return measured.map((w) => Math.round(w || DEFAULT_COLUMN_WIDTH));
}

/**
 * Widths to start a drag from. Once any width is stored, the table is laid
 * out from the stored values, so use those to avoid rounding drift.
 */
export function startingWidths(
	stored: readonly ColumnWidth[],
	measure: () => number[],
): number[] {
	if (stored.some((w) => w !== null)) return stored.map((w) => w ?? DEFAULT_COLUMN_WIDTH);
	return measure();
}
