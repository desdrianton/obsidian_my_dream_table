import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { parseRange } from "../../src/model/address";
import { isBorderStyle, isValidBorderWidth, parseTableData } from "../../src/model/schema";
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
	it.each([0, 1, 20])("accepts width %j", (w) => expect(isValidBorderWidth(w)).toBe(true));
	it.each([-1, 21, 1.5, "1px", null])("rejects width %j", (w) => expect(isValidBorderWidth(w)).toBe(false));
	it.each(["solid", "dashed", "dotted", "double", "none"])("accepts style %s", (s) =>
		expect(isBorderStyle(s)).toBe(true),
	);
	it.each(["groove", "hidden", "", 1])("rejects style %j", (s) => expect(isBorderStyle(s)).toBe(false));
});

describe("table border in the schema", () => {
	it("is optional", () => {
		const result = parseTableData({ rows });
		expect(result.ok && result.table.border).toEqual({});
	});

	it("parses a partial border and ignores nulls", () => {
		const result = parseTableData({ rows, border: { color: "#888", width: 2, style: null } });
		expect(result.ok && result.table.border).toEqual({ color: "#888", width: 2 });
	});

	it("reports each bad field", () => {
		expect(errorsOf({ rows, border: { color: "nope!", width: 30, style: "groove", radius: 4 } })).toEqual([
			'border.color must be a color like "#ff0000", "red", or "var(--color-red)".',
			"border.width must be a whole number of pixels from 0 to 20.",
			"border.style must be one of solid, dashed, dotted, double, none.",
			"border has unknown field `radius`; use color, width, or style.",
		]);
	});

	it("rejects a non-object", () => {
		expect(errorsOf({ rows, border: "1px solid red" })[0]).toMatch(/^`border` must be an object/);
	});
});

describe("cell border in style rules", () => {
	it("accepts the three properties and nulls", () => {
		expect(
			errorsOf({
				rows,
				styles: [
					{ range: "A1", borderColor: "red", borderWidth: 3, borderStyle: "dashed" },
					{ range: "B1", borderColor: null, borderWidth: null, borderStyle: null },
				],
			}),
		).toEqual([]);
	});

	it("rejects invalid values", () => {
		expect(
			errorsOf({ rows, styles: [{ range: "A1", borderColor: "x;y", borderWidth: -1, borderStyle: "wavy" }] }),
		).toHaveLength(3);
	});
});

describe("borders in the model", () => {
	it("resolves each property from the cell, else the table", () => {
		const m = model({
			rows,
			border: { color: "gray", width: 1, style: "solid" },
			styles: [{ range: "A1", borderColor: "red", borderStyle: "dashed" }],
		});
		expect(m.getBorder(0, 0)).toEqual({ color: "red", width: 1, style: "dashed" });
		expect(m.getBorder(1, 1)).toEqual({ color: "gray", width: 1, style: "solid" });
	});

	it("returns an empty border when nothing is set", () => {
		expect(model({ rows }).getBorder(0, 0)).toEqual({});
	});

	it("falls back to the table again after a null rule", () => {
		const m = model({ rows, border: { width: 1 } });
		m.applyStyle(parseRange("A1:B2"), { borderWidth: 4 });
		m.applyStyle(parseRange("A1"), { borderWidth: null });
		expect(m.getBorder(0, 0)).toEqual({ width: 1 });
		expect(m.getBorder(0, 1)).toEqual({ width: 4 });
	});

	it("updates the table border property by property", () => {
		const m = model({ rows, border: { color: "gray", width: 1 } });
		m.updateTableBorder({ style: "dotted" });
		expect(m.tableBorder).toEqual({ color: "gray", width: 1, style: "dotted" });
		m.updateTableBorder({ color: null, width: 3 });
		expect(m.tableBorder).toEqual({ width: 3, style: "dotted" });
		m.updateTableBorder({ color: null, width: null, style: null });
		expect(m.tableBorder).toEqual({});
		expect(m.toData().border).toBeUndefined();
	});

	it("validates table border updates without changing it", () => {
		const m = model({ rows, border: { width: 1 } });
		expect(() => m.updateTableBorder({ width: 99 })).toThrow(RangeError);
		expect(() => m.updateTableBorder({ color: "bad;color" })).toThrow(RangeError);
		expect(() => m.updateTableBorder({ style: "wavy" as never })).toThrow(RangeError);
		expect(m.tableBorder).toEqual({ width: 1 });
	});

	it("does not leak internal state", () => {
		const m = model({ rows, border: { width: 1 } });
		m.tableBorder.width = 5;
		expect(m.tableBorder.width).toBe(1);
		const copy = m.clone();
		copy.updateTableBorder({ width: 7 });
		expect(m.tableBorder.width).toBe(1);
	});

	it("is cleared from cells by clearStyle", () => {
		const m = model({ rows, border: { width: 1 } });
		m.applyStyle(parseRange("A1"), { borderWidth: 3, borderColor: "red" });
		m.clearStyle(parseRange("A1:B2"));
		expect(m.styles).toEqual([]);
		expect(m.getBorder(0, 0)).toEqual({ width: 1 });
	});

	it("round-trips through YAML", () => {
		const m = model({
			rows,
			border: { color: "var(--text-faint)", width: 0, style: "none" },
			styles: [{ range: "A1:B1", borderColor: "#ff0000", borderWidth: 2, borderStyle: "double" }],
		});
		const text = serializeTable(m.toData());
		expect(text).toContain('border: { color: "var(--text-faint)", width: 0, style: "none" }');
		expect(text).toContain('borderColor: "#ff0000", borderWidth: 2, borderStyle: "double"');
		expect(model(load(text)).toData()).toEqual(m.toData());
	});
});
