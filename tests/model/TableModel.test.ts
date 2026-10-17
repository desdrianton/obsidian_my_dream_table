import { describe, expect, it } from "vitest";
import { formatRange, parseRange } from "../../src/model/address";
import { TableModel } from "../../src/model/TableModel";
import type { TableData } from "../../src/model/types";

const r = parseRange;

function model(data: Omit<TableData, "version"> & { version?: number }): TableModel {
	const result = TableModel.parse(data);
	if (!result.ok) throw new Error(result.errors.join("; "));
	return result.model;
}

/** 4x4 grid whose cells hold their own address, e.g. "B3". */
function grid(rowCount = 4, colCount = 4): TableModel {
	const m = TableModel.create(rowCount, colCount);
	for (let row = 0; row < rowCount; row++) {
		for (let col = 0; col < colCount; col++) {
			m.setCell(row, col, formatRange({ top: row, left: col, bottom: row, right: col }));
		}
	}
	return m;
}

function mergeAddresses(m: TableModel): string[] {
	return m.merges.map(formatRange);
}

function styleSummary(m: TableModel) {
	return m.styles.map((rule) => ({ range: formatRange(rule.range), ...rule.style }));
}

describe("creation and parsing", () => {
	it("creates an empty grid", () => {
		const m = TableModel.create(2, 3);
		expect(m.rowCount).toBe(2);
		expect(m.colCount).toBe(3);
		expect(m.getCell(1, 2)).toBe("");
	});

	it("handles a table with no rows", () => {
		const m = TableModel.create(0, 0);
		expect(m.rowCount).toBe(0);
		expect(m.colCount).toBe(0);
	});

	it("rejects invalid sizes", () => {
		expect(() => TableModel.create(-1, 2)).toThrow(RangeError);
		expect(() => TableModel.create(2, 1.5)).toThrow(RangeError);
	});

	it("returns validation errors instead of throwing", () => {
		const result = TableModel.parse({ rows: "nope" });
		expect(result.ok).toBe(false);
	});
});

describe("serialization", () => {
	it("round-trips through toData and parse", () => {
		const data: TableData = {
			version: 1,
			rows: [
				["Produk", "Q1", "Q2", "Q3"],
				["Laptop", "120", "140", "160"],
				["Mouse", "300", "", ""],
			],
			merges: ["B3:D3"],
			styles: [
				{ range: "A1:D1", bg: "#1e3a8a", fg: "#ffffff", bold: true },
				{ range: "B2:D2", align: "right" },
			],
		};
		expect(model(data).toData()).toEqual(data);
	});

	it("omits empty merges and styles", () => {
		expect(TableModel.create(1, 1).toData()).toEqual({ version: 1, rows: [[""]] });
	});

	it("always writes the current version", () => {
		expect(model({ rows: [["a"]] }).toData().version).toBe(1);
	});

	it("does not share state with the returned data", () => {
		const m = model({ rows: [["a"]], merges: [], styles: [{ range: "A1", bold: true }] });
		const data = m.toData();
		data.rows[0]![0] = "changed";
		data.styles![0]!.bold = false;
		expect(m.getCell(0, 0)).toBe("a");
		expect(m.getStyle(0, 0)).toEqual({ bold: true });
	});
});

describe("clone", () => {
	it("produces an independent copy", () => {
		const original = grid(2, 2);
		original.applyStyle(r("A1"), { bold: true });
		const copy = original.clone();

		copy.setCell(0, 0, "changed");
		copy.merge(r("A1:B1"));
		copy.applyStyle(r("A1"), { italic: true });
		copy.insertRows(0);

		expect(original.getCell(0, 0)).toBe("A1");
		expect(original.merges).toEqual([]);
		expect(original.getStyle(0, 0)).toEqual({ bold: true });
		expect(original.rowCount).toBe(2);
	});
});

describe("cells", () => {
	it("reads and writes cells", () => {
		const m = grid();
		m.setCell(1, 2, "**bold** [[link]]");
		expect(m.getCell(1, 2)).toBe("**bold** [[link]]");
	});

	it("rejects out-of-bounds access", () => {
		const m = grid(2, 2);
		expect(() => m.getCell(2, 0)).toThrow(RangeError);
		expect(() => m.getCell(0, -1)).toThrow(RangeError);
		expect(() => m.setCell(0, 2, "x")).toThrow(RangeError);
	});

	it("refuses to write into a cell hidden by a merge", () => {
		const m = grid();
		m.merge(r("A1:B2"));
		expect(() => m.setCell(1, 1, "x")).toThrow(/hidden by merge A1:B2/);
		m.setCell(0, 0, "anchor ok");
		expect(m.getCell(0, 0)).toBe("anchor ok");
	});
});

describe("merge", () => {
	it("merges a range and keeps only the top-left content", () => {
		const m = grid();
		m.merge(r("B2:C3"));
		expect(mergeAddresses(m)).toEqual(["B2:C3"]);
		expect(m.getCell(1, 1)).toBe("B2");
		expect(m.getCell(1, 2)).toBe("");
		expect(m.getCell(2, 1)).toBe("");
		expect(m.getCell(2, 2)).toBe("");
		expect(m.getCell(0, 0)).toBe("A1");
	});

	it("reports anchor and covered cells", () => {
		const m = grid();
		m.merge(r("B2:C3"));
		expect(m.getMergeAt(2, 2)).toEqual(r("B2:C3"));
		expect(m.getMergeAt(0, 0)).toBeUndefined();
		expect(m.isCovered(1, 1)).toBe(false);
		expect(m.isCovered(1, 2)).toBe(true);
		expect(m.isCovered(2, 2)).toBe(true);
		expect(m.isCovered(0, 0)).toBe(false);
	});

	it("absorbs merges fully inside the new range", () => {
		const m = grid();
		m.merge(r("A1:B1"));
		m.merge(r("A3:B3"));
		m.merge(r("A1:C3"));
		expect(mergeAddresses(m)).toEqual(["A1:C3"]);
	});

	it("rejects partial overlap with an existing merge", () => {
		const m = grid();
		m.merge(r("B2:C3"));
		expect(() => m.merge(r("A1:B2"))).toThrow(/partially overlaps merge B2:C3/);
		expect(mergeAddresses(m)).toEqual(["B2:C3"]);
	});

	it("rejects single cells and out-of-bounds ranges", () => {
		const m = grid(2, 2);
		expect(() => m.merge(r("A1"))).toThrow(/single cell/);
		expect(() => m.merge(r("A1:C1"))).toThrow(RangeError);
	});

	it("rejects non-normalized ranges", () => {
		const m = grid();
		expect(() => m.merge({ top: 2, left: 0, bottom: 0, right: 1 })).toThrow(/not normalized/);
	});

	it("returns copies so callers cannot corrupt state", () => {
		const m = grid();
		m.merge(r("A1:B1"));
		const [merge] = m.merges;
		merge!.right = 3;
		m.getMergeAt(0, 0)!.bottom = 3;
		expect(mergeAddresses(m)).toEqual(["A1:B1"]);
	});
});

describe("expandToMerges", () => {
	it("leaves a range alone when no merge sticks out", () => {
		const m = grid();
		m.merge(r("B2:C2"));
		expect(m.expandToMerges(r("A1:D4"))).toEqual(r("A1:D4"));
		expect(m.expandToMerges(r("A4:D4"))).toEqual(r("A4:D4"));
	});

	it("grows to cover a touched merge", () => {
		const m = grid();
		m.merge(r("B2:C3"));
		expect(m.expandToMerges(r("A1:B2"))).toEqual(r("A1:C3"));
	});

	it("follows chains of merges", () => {
		const m = grid();
		m.merge(r("A1:B1"));
		m.merge(r("B2:B3"));
		m.merge(r("A3:A4")); // only touched after growing to include row 3
		// A1:B2 -> touches B2:B3 -> A1:B3 -> touches A3:A4 -> A1:B4
		expect(m.expandToMerges(r("A1:B2"))).toEqual(r("A1:B4"));
	});
});

describe("unmerge", () => {
	it("removes every merge touching the range", () => {
		const m = grid();
		m.merge(r("A1:B1"));
		m.merge(r("C3:D4"));
		m.merge(r("A3:A4"));
		expect(m.unmerge(r("B1:C3"))).toBe(2);
		expect(mergeAddresses(m)).toEqual(["A3:A4"]);
	});

	it("returns 0 when nothing is merged there", () => {
		const m = grid();
		expect(m.unmerge(r("A1"))).toBe(0);
	});
});

describe("styles", () => {
	it("resolves later rules over earlier ones", () => {
		const m = model({
			rows: [["a", "b"]],
			styles: [
				{ range: "A1:B1", bg: "red", bold: true },
				{ range: "B1", bg: "blue" },
			],
		});
		expect(m.getStyle(0, 0)).toEqual({ bg: "red", bold: true });
		expect(m.getStyle(0, 1)).toEqual({ bg: "blue", bold: true });
	});

	it("treats null as a reset to the default", () => {
		const m = model({
			rows: [["a", "b"]],
			styles: [
				{ range: "A1:B1", bold: true },
				{ range: "B1", bold: null },
			],
		});
		expect(m.getStyle(0, 1)).toEqual({});
	});

	it("returns an empty style for unstyled cells", () => {
		expect(grid().getStyle(3, 3)).toEqual({});
	});

	describe("applyStyle", () => {
		it("adds a rule", () => {
			const m = grid();
			m.applyStyle(r("A1:D1"), { bg: "#eee", bold: true });
			expect(styleSummary(m)).toEqual([{ range: "A1:D1", bg: "#eee", bold: true }]);
			expect(m.getStyle(0, 2)).toEqual({ bg: "#eee", bold: true });
			expect(m.getStyle(1, 2)).toEqual({});
		});

		it("ignores an empty style", () => {
			const m = grid();
			m.applyStyle(r("A1"), {});
			m.applyStyle(r("A1"), { bg: undefined });
			expect(m.styles).toEqual([]);
		});

		it("folds repeated edits of the same range into one rule", () => {
			const m = grid();
			m.applyStyle(r("A1:B2"), { bg: "red" });
			m.applyStyle(r("A1:B2"), { bold: true });
			m.applyStyle(r("A1:B2"), { bg: "blue" });
			expect(styleSummary(m)).toEqual([{ range: "A1:B2", bg: "blue", bold: true }]);
		});

		it("prunes earlier rules that are fully overridden", () => {
			const m = grid();
			m.applyStyle(r("A1"), { bg: "red" });
			m.applyStyle(r("B1"), { bg: "green", bold: true });
			m.applyStyle(r("A1:D1"), { bg: "blue" });
			expect(styleSummary(m)).toEqual([
				{ range: "B1", bold: true },
				{ range: "A1:D1", bg: "blue" },
			]);
			expect(m.getStyle(0, 1)).toEqual({ bg: "blue", bold: true });
		});

		it("keeps earlier rules that extend outside the new range", () => {
			const m = grid();
			m.applyStyle(r("A1:D1"), { bg: "red" });
			m.applyStyle(r("B1"), { bg: "blue" });
			expect(styleSummary(m)).toEqual([
				{ range: "A1:D1", bg: "red" },
				{ range: "B1", bg: "blue" },
			]);
		});

		it("does not let a fold reorder precedence", () => {
			const m = grid();
			m.applyStyle(r("A1:B1"), { bg: "red" });
			m.applyStyle(r("A1:D1"), { bg: "green" });
			m.applyStyle(r("A1:B1"), { bold: true });
			// A1:B1 must not be folded into the first rule, which no longer exists anyway.
			expect(m.getStyle(0, 0)).toEqual({ bg: "green", bold: true });
		});

		it("keeps a reset only where it is still needed", () => {
			const m = grid();
			m.applyStyle(r("A1:D1"), { bold: true });
			m.applyStyle(r("B1"), { bold: null });
			expect(styleSummary(m)).toEqual([
				{ range: "A1:D1", bold: true },
				{ range: "B1", bold: null },
			]);
			expect(m.getStyle(0, 1)).toEqual({});
			expect(m.getStyle(0, 2)).toEqual({ bold: true });
		});

		it("drops a reset that has nothing to override", () => {
			const m = grid();
			m.applyStyle(r("A1"), { bold: null });
			expect(m.styles).toEqual([]);
		});
	});

	describe("clearStyle", () => {
		it("removes rules entirely inside the cleared range", () => {
			const m = grid();
			m.applyStyle(r("A1"), { bg: "red" });
			m.applyStyle(r("B2:C2"), { bold: true, align: "center" });
			m.clearStyle(r("A1:D4"));
			expect(m.styles).toEqual([]);
		});

		it("adds only the resets needed for partially covered rules", () => {
			const m = grid();
			m.applyStyle(r("A1:D1"), { bg: "red", bold: true });
			m.applyStyle(r("A2"), { italic: true });
			m.clearStyle(r("A1:A2"));
			expect(styleSummary(m)).toEqual([
				{ range: "A1:D1", bg: "red", bold: true },
				{ range: "A1:A2", bg: null, bold: null },
			]);
			expect(m.getStyle(0, 0)).toEqual({});
			expect(m.getStyle(1, 0)).toEqual({});
			expect(m.getStyle(0, 1)).toEqual({ bg: "red", bold: true });
		});
	});

	it("returns copies so callers cannot corrupt state", () => {
		const m = grid();
		m.applyStyle(r("A1"), { bold: true });
		const [rule] = m.styles;
		rule!.style.bold = false;
		rule!.range.right = 3;
		expect(styleSummary(m)).toEqual([{ range: "A1", bold: true }]);
	});
});

describe("insertRows", () => {
	it("inserts empty rows at the index", () => {
		const m = grid(2, 2);
		m.insertRows(1, 2);
		expect(m.rowCount).toBe(4);
		expect(m.toData().rows).toEqual([
			["A1", "B1"],
			["", ""],
			["", ""],
			["A2", "B2"],
		]);
	});

	it("appends at the end and defaults to one row", () => {
		const m = grid(2, 2);
		m.insertRows(2);
		expect(m.rowCount).toBe(3);
		expect(m.getCell(2, 0)).toBe("");
	});

	it("shifts merges below and grows merges spanning the index", () => {
		const m = grid();
		m.merge(r("A1:A2"));
		m.merge(r("B3:C4"));
		m.insertRows(1);
		expect(mergeAddresses(m)).toEqual(["A1:A3", "B4:C5"]);
	});

	it("shifts and grows styles the same way", () => {
		const m = grid();
		m.applyStyle(r("A1:D1"), { bold: true }); // header: not grown by inserting below it
		m.applyStyle(r("A2:D3"), { bg: "red" });
		m.insertRows(1);
		m.insertRows(3);
		expect(styleSummary(m)).toEqual([
			{ range: "A1:D1", bold: true },
			{ range: "A3:D5", bg: "red" },
		]);
	});

	it("rejects invalid arguments", () => {
		const m = grid(2, 2);
		expect(() => m.insertRows(-1)).toThrow(RangeError);
		expect(() => m.insertRows(3)).toThrow(RangeError);
		expect(() => m.insertRows(0, 0)).toThrow(RangeError);
	});
});

describe("deleteRows", () => {
	it("removes rows", () => {
		const m = grid(4, 1);
		m.deleteRows(1, 2);
		expect(m.toData().rows).toEqual([["A1"], ["A4"]]);
	});

	it("shifts merges and shrinks merges spanning the deletion", () => {
		const m = grid();
		m.merge(r("A1:A3"));
		m.merge(r("B4:C4"));
		m.deleteRows(1);
		expect(mergeAddresses(m)).toEqual(["A1:A2", "B3:C3"]);
	});

	it("drops merges that are deleted or shrink to one cell", () => {
		const m = grid();
		m.merge(r("A1:A2"));
		m.merge(r("B3:C4"));
		m.deleteRows(1, 2);
		expect(mergeAddresses(m)).toEqual(["B2:C2"]);
		m.deleteRows(1);
		expect(mergeAddresses(m)).toEqual([]);
	});

	it("shrinks and drops styles", () => {
		const m = grid();
		m.applyStyle(r("A1:D2"), { bold: true });
		m.applyStyle(r("A3:D3"), { bg: "red" });
		m.deleteRows(1, 2);
		expect(styleSummary(m)).toEqual([{ range: "A1:D1", bold: true }]);
	});

	it("can delete every row", () => {
		const m = grid(2, 2);
		m.deleteRows(0, 2);
		expect(m.rowCount).toBe(0);
	});

	it("rejects ranges past the end", () => {
		const m = grid(2, 2);
		expect(() => m.deleteRows(2)).toThrow(RangeError);
		expect(() => m.deleteRows(1, 2)).toThrow(RangeError);
		expect(() => m.deleteRows(-1)).toThrow(RangeError);
		expect(() => m.deleteRows(0, 0)).toThrow(RangeError);
		expect(m.rowCount).toBe(2);
	});
});

describe("insertColumns", () => {
	it("inserts empty columns in every row", () => {
		const m = grid(2, 2);
		m.insertColumns(1, 2);
		expect(m.toData().rows).toEqual([
			["A1", "", "", "B1"],
			["A2", "", "", "B2"],
		]);
	});

	it("shifts and grows merges and styles", () => {
		const m = grid();
		m.merge(r("A1:B1"));
		m.merge(r("C2:D2"));
		m.applyStyle(r("A3:B3"), { bold: true });
		m.insertColumns(1);
		expect(mergeAddresses(m)).toEqual(["A1:C1", "D2:E2"]);
		expect(styleSummary(m)).toEqual([{ range: "A3:C3", bold: true }]);
	});

	it("rejects invalid arguments", () => {
		const m = grid(2, 2);
		expect(() => m.insertColumns(3)).toThrow(RangeError);
		expect(() => m.insertColumns(0, -1)).toThrow(RangeError);
	});
});

describe("deleteColumns", () => {
	it("removes columns from every row", () => {
		const m = grid(2, 3);
		m.deleteColumns(0, 2);
		expect(m.toData().rows).toEqual([["C1"], ["C2"]]);
		expect(m.colCount).toBe(1);
	});

	it("shrinks, shifts, and drops merges and styles", () => {
		const m = grid();
		m.merge(r("A1:C1"));
		m.merge(r("B2:C2"));
		m.merge(r("D3:D4"));
		m.applyStyle(r("B3"), { bold: true });
		m.deleteColumns(1, 2);
		expect(mergeAddresses(m)).toEqual(["B3:B4"]);
		expect(m.styles).toEqual([]);
	});

	it("rejects ranges past the end", () => {
		const m = grid(2, 2);
		expect(() => m.deleteColumns(2)).toThrow(RangeError);
		expect(() => m.deleteColumns(1, 2)).toThrow(RangeError);
	});
});

describe("scenario: quarterly report", () => {
	it("stays consistent through a sequence of edits", () => {
		const m = TableModel.create(3, 4);
		["Produk", "Q1", "Q2", "Q3"].forEach((v, c) => m.setCell(0, c, v));
		["Laptop", "120", "140", "160"].forEach((v, c) => m.setCell(1, c, v));
		["Mouse", "300"].forEach((v, c) => m.setCell(2, c, v));

		m.applyStyle(r("A1:D1"), { bg: "#1e3a8a", fg: "#ffffff", bold: true });
		m.applyStyle(r("B2:D3"), { align: "right" });
		m.merge(m.expandToMerges(r("B3:D3")));

		m.insertColumns(4); // add Q4 at the end
		m.setCell(0, 4, "Q4");
		m.insertRows(1); // new product under the header
		m.setCell(1, 0, "Keyboard");

		expect(m.toData()).toEqual({
			version: 1,
			rows: [
				["Produk", "Q1", "Q2", "Q3", "Q4"],
				["Keyboard", "", "", "", ""],
				["Laptop", "120", "140", "160", ""],
				["Mouse", "300", "", "", ""],
			],
			merges: ["B4:D4"],
			styles: [
				{ range: "A1:D1", bg: "#1e3a8a", fg: "#ffffff", bold: true },
				{ range: "B3:D4", align: "right" },
			],
		});

		// Round-trips cleanly.
		expect(model(m.toData()).toData()).toEqual(m.toData());
	});
});
