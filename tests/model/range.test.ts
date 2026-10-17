import { describe, expect, it } from "vitest";
import { parseRange } from "../../src/model/address";
import {
	rangeContainsCell,
	rangeContainsRange,
	rangesIntersect,
	shiftRangeForDelete,
	shiftRangeForInsert,
	shiftSpanForDelete,
	shiftSpanForInsert,
	unionRange,
} from "../../src/model/range";

const r = parseRange;

describe("range predicates", () => {
	it("checks whether a cell is inside", () => {
		expect(rangeContainsCell(r("B2:C3"), 1, 1)).toBe(true);
		expect(rangeContainsCell(r("B2:C3"), 2, 2)).toBe(true);
		expect(rangeContainsCell(r("B2:C3"), 0, 1)).toBe(false);
		expect(rangeContainsCell(r("B2:C3"), 1, 3)).toBe(false);
	});

	it("checks containment", () => {
		expect(rangeContainsRange(r("A1:D4"), r("B2:C3"))).toBe(true);
		expect(rangeContainsRange(r("A1:D4"), r("A1:D4"))).toBe(true);
		expect(rangeContainsRange(r("B2:C3"), r("A1:D4"))).toBe(false);
		expect(rangeContainsRange(r("A1:B2"), r("B2:C3"))).toBe(false);
	});

	it("checks intersection, including touching corners", () => {
		expect(rangesIntersect(r("A1:B2"), r("B2:C3"))).toBe(true);
		expect(rangesIntersect(r("A1:B2"), r("C1:D2"))).toBe(false);
		expect(rangesIntersect(r("A1:B2"), r("A3:B4"))).toBe(false);
	});

	it("computes the bounding box", () => {
		expect(unionRange(r("A1:B2"), r("C3:D4"))).toEqual(r("A1:D4"));
	});
});

describe("shiftSpanForInsert", () => {
	// Span covers lines 2..4.
	it("shifts when inserting before the span", () => {
		expect(shiftSpanForInsert(2, 4, 0, 2)).toEqual([4, 6]);
	});

	it("shifts when inserting exactly at the start", () => {
		expect(shiftSpanForInsert(2, 4, 2, 1)).toEqual([3, 5]);
	});

	it("grows when inserting inside the span", () => {
		expect(shiftSpanForInsert(2, 4, 3, 2)).toEqual([2, 6]);
		expect(shiftSpanForInsert(2, 4, 4, 1)).toEqual([2, 5]);
	});

	it("is unaffected when inserting right after the span", () => {
		expect(shiftSpanForInsert(2, 4, 5, 3)).toEqual([2, 4]);
	});
});

describe("shiftSpanForDelete", () => {
	// Span covers lines 2..5.
	it("shifts when deleting before the span", () => {
		expect(shiftSpanForDelete(2, 5, 0, 2)).toEqual([0, 3]);
	});

	it("shrinks when deleting inside the span", () => {
		expect(shiftSpanForDelete(2, 5, 3, 2)).toEqual([2, 3]);
	});

	it("shrinks when deleting overlapping the start", () => {
		expect(shiftSpanForDelete(2, 5, 1, 3)).toEqual([1, 2]);
	});

	it("shrinks when deleting overlapping the end", () => {
		expect(shiftSpanForDelete(2, 5, 4, 5)).toEqual([2, 3]);
	});

	it("is unaffected when deleting after the span", () => {
		expect(shiftSpanForDelete(2, 5, 6, 2)).toEqual([2, 5]);
	});

	it("returns null when the whole span is deleted", () => {
		expect(shiftSpanForDelete(2, 5, 2, 4)).toBeNull();
		expect(shiftSpanForDelete(2, 5, 0, 10)).toBeNull();
	});
});

describe("range shifting by axis", () => {
	it("only changes the rows for the row axis", () => {
		expect(shiftRangeForInsert(r("B2:C3"), "row", 0, 1)).toEqual(r("B3:C4"));
		expect(shiftRangeForDelete(r("B2:C3"), "row", 0, 1)).toEqual(r("B1:C2"));
	});

	it("only changes the columns for the column axis", () => {
		expect(shiftRangeForInsert(r("B2:C3"), "col", 0, 1)).toEqual(r("C2:D3"));
		expect(shiftRangeForDelete(r("B2:C3"), "col", 0, 1)).toEqual(r("A2:B3"));
	});

	it("returns null when the range is deleted", () => {
		expect(shiftRangeForDelete(r("B2:C3"), "col", 1, 2)).toBeNull();
	});
});
