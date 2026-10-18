import { describe, expect, it } from "vitest";
import { formatRange, parseRange } from "../../src/model/address";
import { parseTableData } from "../../src/model/schema";
import { TableModel } from "../../src/model/TableModel";

const r = parseRange;

function grid(rowCount = 4, colCount = 2): TableModel {
	const m = TableModel.create(rowCount, colCount);
	for (let row = 0; row < rowCount; row++) {
		for (let col = 0; col < colCount; col++) {
			m.setCell(row, col, formatRange({ top: row, left: col, bottom: row, right: col }));
		}
	}
	return m;
}

function errors(input: unknown): string[] {
	const result = parseTableData(input);
	return result.ok ? [] : result.errors;
}

describe("parsing header and collapsed", () => {
	it("defaults to no header, expanded", () => {
		const result = TableModel.parse({ rows: [["a"], ["b"]] });
		if (!result.ok) throw new Error();
		expect(result.model.headerRows).toBe(0);
		expect(result.model.collapsed).toBe(false);
		expect(result.model.toData()).not.toHaveProperty("header");
		expect(result.model.toData()).not.toHaveProperty("collapsed");
	});

	it("round-trips through toData", () => {
		const result = TableModel.parse({ rows: [["a"], ["b"], ["c"]], header: 2, collapsed: true });
		if (!result.ok) throw new Error(result.errors.join("; "));
		expect(result.model.headerRows).toBe(2);
		expect(result.model.collapsed).toBe(true);
		expect(result.model.visibleRowCount).toBe(2);
		expect(result.model.toData()).toMatchObject({ header: 2, collapsed: true });
	});

	it("rejects bad values", () => {
		expect(errors({ rows: [["a"]], header: -1 })[0]).toMatch(/`header`/);
		expect(errors({ rows: [["a"]], header: 1.5 })[0]).toMatch(/`header`/);
		expect(errors({ rows: [["a"]], header: 2 })[0]).toMatch(/only 1 rows/);
		expect(errors({ rows: [["a"]], header: 1, collapsed: "yes" })[0]).toMatch(/`collapsed`/);
		expect(errors({ rows: [["a"]], collapsed: true })[0]).toMatch(/needs a `header`/);
	});

	it("rejects a merge crossing the end of the header", () => {
		expect(errors({ rows: [["a"], ["b"]], merges: ["A1:A2"], header: 1 })[0]).toMatch(/A1:A2/);
		expect(errors({ rows: [["a"], ["b"]], merges: ["A1:A2"], header: 2 })).toEqual([]);
	});
});

describe("header rows", () => {
	it("can be set and removed; removing it expands the table", () => {
		const m = grid();
		m.setHeaderRows(1);
		m.collapsed = true;
		expect(m.visibleRowCount).toBe(1);
		m.setHeaderRows(0);
		expect(m.collapsed).toBe(false);
		expect(m.visibleRowCount).toBe(4);
	});

	it("cannot be collapsed without a header", () => {
		expect(() => {
			grid().collapsed = true;
		}).toThrow();
	});

	it("may not cut through a merge", () => {
		const m = grid();
		m.merge(r("A1:A2"));
		expect(m.canSetHeaderRows(1)).toBe(false);
		expect(() => m.setHeaderRows(1)).toThrow(/A1:A2/);
		expect(m.canSetHeaderRows(2)).toBe(true);
		m.setHeaderRows(2);
		expect(() => m.merge(r("B2:B3"))).toThrow(/header/);
	});

	it("rejects counts outside the table", () => {
		expect(() => grid().setHeaderRows(5)).toThrow(RangeError);
		expect(grid().canSetHeaderRows(5)).toBe(false);
	});

	it("grows when rows are inserted inside it", () => {
		const m = grid();
		m.setHeaderRows(2);
		m.insertRows(1);
		expect(m.headerRows).toBe(3);
		m.insertRows(3);
		expect(m.headerRows).toBe(3);
	});

	it("shrinks when its rows are deleted", () => {
		const m = grid();
		m.setHeaderRows(2);
		m.collapsed = true;
		m.deleteRows(1, 2);
		expect(m.headerRows).toBe(1);
		expect(m.collapsed).toBe(true);
		m.deleteRows(0);
		expect(m.headerRows).toBe(0);
		expect(m.collapsed).toBe(false);
	});

	it("is kept by clone", () => {
		const m = grid();
		m.setHeaderRows(1);
		m.collapsed = true;
		const copy = m.clone();
		expect(copy.headerRows).toBe(1);
		expect(copy.collapsed).toBe(true);
	});
});
