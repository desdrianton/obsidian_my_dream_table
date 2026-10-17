import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { parseRange } from "../../src/model/address";
import { isValidPadding, parseTableData } from "../../src/model/schema";
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

describe("isValidPadding", () => {
	it.each([0, 1, 8, 100])("accepts %j", (value) => expect(isValidPadding(value)).toBe(true));
	it.each([-1, 101, 2.5, "8", "8px", null, Number.NaN])("rejects %j", (value) =>
		expect(isValidPadding(value)).toBe(false),
	);
});

describe("table padding in the schema", () => {
	it("is optional", () => {
		const result = parseTableData({ rows });
		expect(result.ok && result.table.padding).toBeNull();
	});

	it("accepts a whole number of pixels", () => {
		const result = parseTableData({ rows, padding: 12 });
		expect(result.ok && result.table.padding).toBe(12);
	});

	it.each([-1, 2.5, "12px", 101])("rejects %j", (padding) => {
		expect(errorsOf({ rows, padding })).toEqual([
			"`padding` must be a whole number of pixels from 0 to 100.",
		]);
	});
});

describe("cell padding in style rules", () => {
	it("accepts a number and null", () => {
		expect(errorsOf({ rows, styles: [{ range: "A1", padding: 0 }, { range: "B1", padding: null }] })).toEqual([]);
	});

	it("rejects invalid values", () => {
		expect(errorsOf({ rows, styles: [{ range: "A1", padding: "4px" }] })).toEqual([
			"styles[0].padding must be a whole number of pixels from 0 to 100.",
		]);
	});
});

describe("padding in the model", () => {
	it("falls back from the cell style to the table default", () => {
		const m = model({ rows, padding: 12, styles: [{ range: "A1", padding: 2 }] });
		expect(m.getPadding(0, 0)).toBe(2);
		expect(m.getPadding(1, 1)).toBe(12);
		m.tablePadding = null;
		expect(m.getPadding(1, 1)).toBeNull();
	});

	it("lets a later null rule fall back to the table default again", () => {
		const m = model({ rows, padding: 12 });
		m.applyStyle(parseRange("A1:B2"), { padding: 4 });
		m.applyStyle(parseRange("A1"), { padding: null });
		expect(m.getPadding(0, 0)).toBe(12);
		expect(m.getPadding(0, 1)).toBe(4);
	});

	it("validates the table padding", () => {
		const m = model({ rows });
		expect(() => {
			m.tablePadding = -3;
		}).toThrow(RangeError);
		expect(() => {
			m.tablePadding = 1.5;
		}).toThrow(RangeError);
	});

	it("is cleared from cells by clearStyle but the table default stays", () => {
		const m = model({ rows, padding: 10 });
		m.applyStyle(parseRange("A1"), { padding: 0, bold: true });
		m.clearStyle(parseRange("A1:B2"));
		expect(m.styles).toEqual([]);
		expect(m.getPadding(0, 0)).toBe(10);
	});

	it("is copied by clone", () => {
		const m = model({ rows, padding: 10 });
		const copy = m.clone();
		copy.tablePadding = 20;
		expect(m.tablePadding).toBe(10);
	});

	it("round-trips through YAML, including padding 0", () => {
		const m = model({ rows, padding: 0, styles: [{ range: "A1:B1", padding: 16 }] });
		const text = serializeTable(m.toData());
		expect(text).toContain("padding: 0\n");
		expect(text).toContain('{ range: "A1:B1", padding: 16 }');
		const back = model(load(text));
		expect(back.tablePadding).toBe(0);
		expect(back.getPadding(0, 0)).toBe(16);
		expect(back.toData()).toEqual(m.toData());
	});

	it("omits the table padding when unset", () => {
		expect(model({ rows }).toData().padding).toBeUndefined();
	});
});
