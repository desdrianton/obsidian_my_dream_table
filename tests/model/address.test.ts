import { describe, expect, it } from "vitest";
import {
	columnToLetters,
	formatCellRef,
	formatRange,
	lettersToColumn,
	parseCellRef,
	parseRange,
} from "../../src/model/address";

describe("column letters", () => {
	it.each([
		[0, "A"],
		[25, "Z"],
		[26, "AA"],
		[27, "AB"],
		[51, "AZ"],
		[52, "BA"],
		[701, "ZZ"],
		[702, "AAA"],
	])("column %i <-> %s", (col, letters) => {
		expect(columnToLetters(col)).toBe(letters);
		expect(lettersToColumn(letters)).toBe(col);
	});

	it("round-trips the first thousand columns", () => {
		for (let col = 0; col < 1000; col++) {
			expect(lettersToColumn(columnToLetters(col))).toBe(col);
		}
	});

	it("rejects invalid input", () => {
		expect(() => columnToLetters(-1)).toThrow(RangeError);
		expect(() => columnToLetters(1.5)).toThrow(RangeError);
		expect(() => lettersToColumn("")).toThrow(SyntaxError);
		expect(() => lettersToColumn("a")).toThrow(SyntaxError);
		expect(() => lettersToColumn("A1")).toThrow(SyntaxError);
	});
});

describe("cell references", () => {
	it("parses A1 notation to zero-based indices", () => {
		expect(parseCellRef("A1")).toEqual({ row: 0, col: 0 });
		expect(parseCellRef("B3")).toEqual({ row: 2, col: 1 });
		expect(parseCellRef("AA10")).toEqual({ row: 9, col: 26 });
	});

	it("is case-insensitive and trims whitespace", () => {
		expect(parseCellRef(" b3 ")).toEqual({ row: 2, col: 1 });
	});

	it.each(["", "A", "1", "A0", "A01", "1A", "A-1", "A1B"])("rejects %j", (ref) => {
		expect(() => parseCellRef(ref)).toThrow(SyntaxError);
	});

	it("formats back to A1 notation", () => {
		expect(formatCellRef({ row: 2, col: 1 })).toBe("B3");
	});
});

describe("ranges", () => {
	it("parses a two-corner range", () => {
		expect(parseRange("A1:C2")).toEqual({ top: 0, left: 0, bottom: 1, right: 2 });
	});

	it("treats a single cell as a 1x1 range", () => {
		expect(parseRange("B3")).toEqual({ top: 2, left: 1, bottom: 2, right: 1 });
	});

	it("normalizes reversed corners", () => {
		expect(parseRange("C2:A1")).toEqual(parseRange("A1:C2"));
		expect(parseRange("A2:C1")).toEqual(parseRange("A1:C2"));
	});

	it("rejects malformed ranges", () => {
		expect(() => parseRange("A1:B2:C3")).toThrow(SyntaxError);
		expect(() => parseRange("A1:")).toThrow(SyntaxError);
		expect(() => parseRange(":B2")).toThrow(SyntaxError);
	});

	it("formats single cells without a colon", () => {
		expect(formatRange({ top: 2, left: 1, bottom: 2, right: 1 })).toBe("B3");
		expect(formatRange({ top: 0, left: 0, bottom: 1, right: 2 })).toBe("A1:C2");
	});
});
