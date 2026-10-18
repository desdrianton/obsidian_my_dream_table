import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { parseRange } from "../../src/model/address";
import { isValidFontFamily, isValidFontSize, parseTableData } from "../../src/model/schema";
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
	it.each([6, 12, 16, 96])("accepts font size %j", (v) => expect(isValidFontSize(v)).toBe(true));
	it.each([5, 97, 12.5, "12", "12px", null])("rejects font size %j", (v) => expect(isValidFontSize(v)).toBe(false));

	it.each([
		"Georgia",
		"Georgia, serif",
		'"Fira Code", monospace',
		"'Times New Roman', Times, serif",
		"var(--font-monospace)",
		"Open Sans",
	])("accepts font family %j", (v) => expect(isValidFontFamily(v)).toBe(true));

	it.each([
		"",
		"Arial,",
		"Arial; color: red",
		"url(evil)",
		'"unterminated',
		'"a\\"b"',
		"var(--x); color: red",
		"x".repeat(201),
		12,
	])("rejects font family %j", (v) => expect(isValidFontFamily(v)).toBe(false));
});

describe("table font in the schema", () => {
	it("is optional", () => {
		const result = parseTableData({ rows });
		expect(result.ok && [result.table.fontSize, result.table.fontFamily]).toEqual([null, null]);
	});

	it("accepts a size and a trimmed family", () => {
		const result = parseTableData({ rows, fontSize: 14, fontFamily: "  Georgia, serif " });
		expect(result.ok && [result.table.fontSize, result.table.fontFamily]).toEqual([14, "Georgia, serif"]);
	});

	it("rejects invalid values", () => {
		expect(errorsOf({ rows, fontSize: "14px", fontFamily: "a;b" })).toEqual([
			"`fontSize` must be a whole number of pixels from 6 to 96.",
			'`fontFamily` must be a font name or a comma-separated list, e.g. "Georgia, serif" or "var(--font-monospace)".',
		]);
	});
});

describe("cell font in style rules", () => {
	it("accepts size, family, script, and null", () => {
		const result = parseTableData({
			rows,
			styles: [
				{ range: "A1", fontSize: 20, fontFamily: " Georgia ", script: "sup" },
				{ range: "B1", fontSize: null, fontFamily: null, script: null },
			],
		});
		expect(result.ok && result.table.styles.map((s) => s.style)).toEqual([
			{ fontSize: 20, fontFamily: "Georgia", script: "sup" },
			{ fontSize: null, fontFamily: null, script: null },
		]);
	});

	it("rejects invalid values", () => {
		expect(errorsOf({ rows, styles: [{ range: "A1", fontSize: 200, script: "super" }] })).toEqual([
			"styles[0].fontSize must be a whole number of pixels from 6 to 96.",
			"styles[0].script must be one of sub, sup.",
		]);
	});
});

describe("font in the model", () => {
	it("falls back from the cell style to the table default", () => {
		const m = model({
			rows,
			fontSize: 14,
			fontFamily: "Georgia",
			styles: [{ range: "A1", fontSize: 20, fontFamily: "var(--font-monospace)" }],
		});
		expect([m.getFontSize(0, 0), m.getFontFamily(0, 0)]).toEqual([20, "var(--font-monospace)"]);
		expect([m.getFontSize(1, 1), m.getFontFamily(1, 1)]).toEqual([14, "Georgia"]);
		m.tableFontSize = null;
		m.tableFontFamily = null;
		expect([m.getFontSize(1, 1), m.getFontFamily(1, 1)]).toEqual([null, null]);
	});

	it("validates the table font", () => {
		const m = model({ rows });
		expect(() => {
			m.tableFontSize = 3;
		}).toThrow(RangeError);
		expect(() => {
			m.tableFontFamily = "a; b";
		}).toThrow(RangeError);
		expect([m.tableFontSize, m.tableFontFamily]).toEqual([null, null]);
	});

	it("is cleared from cells by clearStyle but the table default stays", () => {
		const m = model({ rows, fontSize: 12 });
		m.applyStyle(parseRange("A1"), { fontSize: 30, script: "sub" });
		m.clearStyle(parseRange("A1:B2"));
		expect(m.styles).toEqual([]);
		expect(m.getFontSize(0, 0)).toBe(12);
	});

	it("is copied by clone", () => {
		const m = model({ rows, fontSize: 12, fontFamily: "Georgia" });
		const copy = m.clone();
		copy.tableFontSize = 20;
		copy.tableFontFamily = "Arial";
		expect([m.tableFontSize, m.tableFontFamily]).toEqual([12, "Georgia"]);
	});

	it("round-trips through YAML", () => {
		const m = model({
			rows,
			fontSize: 13,
			fontFamily: '"Fira Code", monospace',
			styles: [{ range: "A1:B1", fontSize: 18, fontFamily: "Georgia, serif", script: "sub" }],
		});
		const text = serializeTable(m.toData());
		expect(text).toContain("fontSize: 13\n");
		expect(text).toContain('fontFamily: "\\"Fira Code\\", monospace"\n');
		expect(text).toContain('{ range: "A1:B1", fontSize: 18, fontFamily: "Georgia, serif", script: "sub" }');
		expect(model(load(text)).toData()).toEqual(m.toData());
	});

	it("omits the table font when unset", () => {
		const data = model({ rows }).toData();
		expect([data.fontSize, data.fontFamily]).toEqual([undefined, undefined]);
	});
});
