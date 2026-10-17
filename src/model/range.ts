import type { Range } from "./types";

export function rangeContainsCell(range: Range, row: number, col: number): boolean {
	return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

/** True if `inner` lies entirely within `outer`. */
export function rangeContainsRange(outer: Range, inner: Range): boolean {
	return (
		inner.top >= outer.top &&
		inner.bottom <= outer.bottom &&
		inner.left >= outer.left &&
		inner.right <= outer.right
	);
}

export function rangesIntersect(a: Range, b: Range): boolean {
	return a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right;
}

export function rangesEqual(a: Range, b: Range): boolean {
	return a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;
}

export function isSingleCell(range: Range): boolean {
	return range.top === range.bottom && range.left === range.right;
}

/** Bounding box of two ranges. */
export function unionRange(a: Range, b: Range): Range {
	return {
		top: Math.min(a.top, b.top),
		left: Math.min(a.left, b.left),
		bottom: Math.max(a.bottom, b.bottom),
		right: Math.max(a.right, b.right),
	};
}

export type Axis = "row" | "col";

/**
 * Adjusts a span [start, end] on one axis after `count` lines are inserted
 * before `index`. Inserting strictly inside the span grows it; inserting at or
 * before its start shifts it.
 */
export function shiftSpanForInsert(
	start: number,
	end: number,
	index: number,
	count: number,
): [number, number] {
	if (index <= start) return [start + count, end + count];
	if (index <= end) return [start, end + count];
	return [start, end];
}

/**
 * Adjusts a span [start, end] on one axis after lines [index, index + count)
 * are deleted. Returns null when the whole span was deleted.
 */
export function shiftSpanForDelete(
	start: number,
	end: number,
	index: number,
	count: number,
): [number, number] | null {
	const delEnd = index + count - 1;
	const removedBefore = (pos: number) => Math.max(0, Math.min(pos, delEnd + 1) - index);
	const newStart = start - removedBefore(start);
	const newEnd = end - removedBefore(end + 1);
	return newEnd < newStart ? null : [newStart, newEnd];
}

export function shiftRangeForInsert(range: Range, axis: Axis, index: number, count: number): Range {
	if (axis === "row") {
		const [top, bottom] = shiftSpanForInsert(range.top, range.bottom, index, count);
		return { ...range, top, bottom };
	}
	const [left, right] = shiftSpanForInsert(range.left, range.right, index, count);
	return { ...range, left, right };
}

export function shiftRangeForDelete(
	range: Range,
	axis: Axis,
	index: number,
	count: number,
): Range | null {
	if (axis === "row") {
		const span = shiftSpanForDelete(range.top, range.bottom, index, count);
		return span && { ...range, top: span[0], bottom: span[1] };
	}
	const span = shiftSpanForDelete(range.left, range.right, index, count);
	return span && { ...range, left: span[0], right: span[1] };
}
