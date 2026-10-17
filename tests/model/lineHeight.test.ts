import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { parseRange } from "../../src/model/address";
import { isValidLineHeight, parseTableData, roundLineHeight } from "../../src/model/schema";
import { serializeTable } from "../../src/model/serialize";
import { TableModel } from "../../src/model/TableModel";

const rows = [["a", "b"], ["c", "d"]];

function model(input: unknown): TableModel {
	const result = TableModel.parse(input);
	if (!result.ok) throw new Error(result.errors.join("; "));
	return result.model;
}

function errorsOf(input: unknown): string[] {
	const result = parseTableData(input);
	return result.ok ? [] : result.errors;
}

describe("validators", () => {
	it.each([0.5, 1, 1.25, 2, 5])("accepts %j", (v) => expect(isValidLineHeight(v)).toBe(true));
	it.each([0.4, 5.1, "1.5", Number.NaN, Number.POSITIVE_INFINITY, null])("rejects %j", (v) =>
		expect(isValidLineHeight(v)).toBe(false),
	);

	it("rounds to two decimals", () => {
		expect(roundLineHeight(1.333333)).toBe(1.33);
		expect(roundLineHeight(1.5)).toBe(1.5);
	});
});

describe("table line height in the schema", () => {
	it("is optional", () => {
		const result = parseTableData({ rows });
		expect(result.ok && result.table.lineHeight).toBeNull();
	});

	it("accepts and rounds a number", () => {
		const result = parseTableData({ rows, lineHeight: 1.6666 });
		expect(result.ok && result.table.lineHeight).toBe(1.67);
	});

	it.each([0, 10, "2", "150%"])("rejects %j", (lineHeight) => {
		expect(errorsOf({ rows, lineHeight })).toEqual(["`lineHeight` must be a number from 0.5 to 5, e.g. 1.5."]);
	});
});

describe("cell line height in style rules", () => {
	it("accepts a number and null, rounding the number", () => {
		const result = parseTableData({
			rows,
			styles: [
				{ range: "A1", lineHeight: 1.234 },
				{ range: "B1", lineHeight: null },
			],
		});
		expect(result.ok && result.table.styles.map((s) => s.style)).toEqual([{ lineHeight: 1.23 }, { lineHeight: null }]);
	});

	it("rejects invalid values", () => {
		expect(errorsOf({ rows, styles: [{ range: "A1", lineHeight: "2em" }] })).toEqual([
			"styles[0].lineHeight must be a number from 0.5 to 5, e.g. 1.5.",
		]);
	});
});

describe("line height in the model", () => {
	it("falls back from the cell style to the table default", () => {
		const m = model({ rows, lineHeight: 1.5, styles: [{ range: "A1", lineHeight: 2 }] });
		expect(m.getLineHeight(0, 0)).toBe(2);
		expect(m.getLineHeight(1, 1)).toBe(1.5);
		m.tableLineHeight = null;
		expect(m.getLineHeight(1, 1)).toBeNull();
	});

	it("validates and rounds the table line height", () => {
		const m = model({ rows });
		m.tableLineHeight = 1.4567;
		expect(m.tableLineHeight).toBe(1.46);
		expect(() => {
			m.tableLineHeight = 0.1;
		}).toThrow(RangeError);
		expect(m.tableLineHeight).toBe(1.46);
	});

	it("is cleared from cells by clearStyle but the table default stays", () => {
		const m = model({ rows, lineHeight: 1.25 });
		m.applyStyle(parseRange("A1"), { lineHeight: 3 });
		m.clearStyle(parseRange("A1:B2"));
		expect(m.styles).toEqual([]);
		expect(m.getLineHeight(0, 0)).toBe(1.25);
	});

	it("is copied by clone", () => {
		const m = model({ rows, lineHeight: 1.25 });
		const copy = m.clone();
		copy.tableLineHeight = 2;
		expect(m.tableLineHeight).toBe(1.25);
	});

	it("round-trips through YAML", () => {
		const m = model({ rows, lineHeight: 1.75, styles: [{ range: "A1:B1", lineHeight: 1 }] });
		const text = serializeTable(m.toData());
		expect(text).toContain("lineHeight: 1.75\n");
		expect(text).toContain('{ range: "A1:B1", lineHeight: 1 }');
		expect(model(load(text)).toData()).toEqual(m.toData());
	});

	it("omits the table line height when unset", () => {
		expect(model({ rows }).toData().lineHeight).toBeUndefined();
	});
});
