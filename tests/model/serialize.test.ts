import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { serializeTable } from "../../src/model/serialize";
import { TableModel } from "../../src/model/TableModel";
import type { TableData } from "../../src/model/types";

function roundTrip(data: TableData): unknown {
	return load(serializeTable(data));
}

describe("serializeTable", () => {
	it("writes one table row per line", () => {
		const text = serializeTable({
			version: 1,
			rows: [
				["Produk", "Q1"],
				["Laptop", "120"],
			],
			merges: ["A1:B1"],
			styles: [{ range: "A1:B1", bg: "#1e3a8a", bold: true, align: "center" }],
		});
		expect(text).toBe(
			[
				"version: 1",
				"rows:",
				'  - ["Produk", "Q1"]',
				'  - ["Laptop", "120"]',
				'merges: ["A1:B1"]',
				"styles:",
				'  - { range: "A1:B1", bg: "#1e3a8a", bold: true, align: "center" }',
				"",
			].join("\n"),
		);
	});

	it("omits empty merges and styles", () => {
		expect(serializeTable({ version: 1, rows: [["a"]], merges: [], styles: [] })).toBe(
			'version: 1\nrows:\n  - ["a"]\n',
		);
	});

	it("writes style keys in a stable order and keeps null resets", () => {
		const text = serializeTable({
			version: 1,
			rows: [["a"]],
			styles: [{ valign: "top", bold: null, range: "A1", fg: "red" }],
		});
		expect(text).toContain('  - { range: "A1", fg: "red", bold: null, valign: "top" }');
	});

	it("round-trips text that is special in YAML", () => {
		const tricky = [
			"# not a comment",
			"key: value",
			"- not a list",
			"[not, a, list]",
			"{not: a map}",
			"yes",
			"null",
			"~",
			"123",
			"1e3",
			'quote " and \\ backslash',
			"'single'",
			"line1\nline2",
			"tab\there",
			"  padded  ",
			"emoji 🎉 dan aksara 漢字",
			"[[Wiki link|alias]] and **bold** and `code`",
			"",
		];
		const data: TableData = { version: 1, rows: [tricky] };
		expect(roundTrip(data)).toEqual(data);
	});

	it("round-trips a full model through YAML and back", () => {
		const model = TableModel.create(3, 3);
		model.setCell(0, 0, "Header");
		model.merge({ top: 0, left: 0, bottom: 0, right: 2 });
		model.applyStyle({ top: 0, left: 0, bottom: 0, right: 2 }, { bg: "var(--color-red)", italic: true });
		model.applyStyle({ top: 1, left: 1, bottom: 1, right: 1 }, { bg: "rgb(1, 2, 3)" });

		const result = TableModel.parse(roundTrip(model.toData()));
		if (!result.ok) throw new Error(result.errors.join("; "));
		expect(result.model.toData()).toEqual(model.toData());
	});
});

describe("serializeTable: header", () => {
	it("writes header and collapsed only when set", () => {
		expect(serializeTable({ version: 1, rows: [["a"]] })).not.toMatch(/header|collapsed/);
		const text = serializeTable({ version: 1, rows: [["a"], ["b"]], header: 1, collapsed: true });
		expect(text).toContain("header: 1\ncollapsed: true\n");
		expect(roundTrip({ version: 1, rows: [["a"], ["b"]], header: 1, collapsed: true })).toMatchObject({
			header: 1,
			collapsed: true,
		});
	});
});
