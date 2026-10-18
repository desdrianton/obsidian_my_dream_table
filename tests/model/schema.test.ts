import { describe, expect, it } from "vitest";
import { parseRange } from "../../src/model/address";
import { isValidColor, parseTableData, type ParseResult } from "../../src/model/schema";

function expectErrors(result: ParseResult): string[] {
	if (result.ok) throw new Error("Expected parse to fail");
	return result.errors;
}

function expectTable(result: ParseResult) {
	if (!result.ok) throw new Error(`Expected parse to succeed: ${result.errors.join("; ")}`);
	return result.table;
}

describe("parseTableData: valid input", () => {
	it("parses a full table", () => {
		const table = expectTable(
			parseTableData({
				version: 1,
				rows: [
					["Produk", "Q1", "Q2"],
					["Laptop", "120", "140"],
				],
				merges: ["B1:C1"],
				styles: [{ range: "A1:C1", bg: "#1e3a8a", fg: "white", bold: true }],
			}),
		);
		expect(table.rows).toEqual([
			["Produk", "Q1", "Q2"],
			["Laptop", "120", "140"],
		]);
		expect(table.merges).toEqual([parseRange("B1:C1")]);
		expect(table.styles).toEqual([
			{ range: parseRange("A1:C1"), style: { bg: "#1e3a8a", fg: "white", bold: true } },
		]);
	});

	it("allows a missing version, merges, and styles", () => {
		const table = expectTable(parseTableData({ rows: [["a"]] }));
		expect(table).toEqual({ rows: [["a"]], merges: [], styles: [], widths: [null], padding: null, border: {}, lineHeight: null, fontSize: null, fontFamily: null, header: 0, collapsed: false });
	});

	it("converts YAML scalars in cells to strings", () => {
		const table = expectTable(parseTableData({ rows: [[120, 1.5, true, null, "x"]] }));
		expect(table.rows).toEqual([["120", "1.5", "true", "", "x"]]);
	});

	it("pads ragged rows to a rectangle", () => {
		const table = expectTable(parseTableData({ rows: [["a", "b", "c"], ["d"], []] }));
		expect(table.rows).toEqual([
			["a", "b", "c"],
			["d", "", ""],
			["", "", ""],
		]);
	});

	it("accepts an empty table", () => {
		expect(expectTable(parseTableData({ rows: [] })).rows).toEqual([]);
	});

	it("keeps explicit null resets in styles", () => {
		const table = expectTable(parseTableData({ rows: [["a"]], styles: [{ range: "A1", bg: null }] }));
		expect(table.styles[0]!.style).toEqual({ bg: null });
	});

	it("allows style ranges beyond the table", () => {
		const table = expectTable(parseTableData({ rows: [["a"]], styles: [{ range: "A1:Z1", bold: true }] }));
		expect(table.styles).toHaveLength(1);
	});
});

describe("parseTableData: invalid input", () => {
	it.each([null, "text", 42, [["a"]]])("rejects a non-object root: %j", (input) => {
		expect(expectErrors(parseTableData(input))).toHaveLength(1);
	});

	it("requires rows to be a list of lists", () => {
		expect(expectErrors(parseTableData({}))).toContain("`rows` must be a list of rows.");
		expect(expectErrors(parseTableData({ rows: ["a"] }))).toContain("rows[0] must be a list of cells.");
	});

	it("rejects nested objects in cells", () => {
		expect(expectErrors(parseTableData({ rows: [["a", { b: 1 }]] }))).toContain(
			"rows[0][1] must be text, a number, or empty.",
		);
	});

	it("rejects a version from the future", () => {
		const [error] = expectErrors(parseTableData({ version: 99, rows: [] }));
		expect(error).toMatch(/version 99/);
	});

	it.each([0, -1, 1.5, "1"])("rejects an invalid version: %j", (version) => {
		expect(expectErrors(parseTableData({ version, rows: [] }))).toContain(
			"`version` must be a positive integer.",
		);
	});

	it("rejects unknown top-level fields to catch typos", () => {
		expect(expectErrors(parseTableData({ rows: [], merge: ["A1:B1"] }))).toContain(
			"Unknown field `merge`.",
		);
	});

	describe("merges", () => {
		const rows = [
			["a", "b", "c"],
			["d", "e", "f"],
		];

		it("rejects malformed ranges", () => {
			const errors = expectErrors(parseTableData({ rows, merges: ["A1:", 5] }));
			expect(errors).toEqual([
				'merges[0] has an invalid range "A1:".',
				'merges[1] must be a range like "A1:B2".',
			]);
		});

		it("rejects single-cell merges", () => {
			expect(expectErrors(parseTableData({ rows, merges: ["A1"] }))[0]).toMatch(/more than one cell/);
		});

		it("rejects merges outside the table", () => {
			expect(expectErrors(parseTableData({ rows, merges: ["A1:D1"] }))[0]).toMatch(/outside/);
			expect(expectErrors(parseTableData({ rows, merges: ["A2:A3"] }))[0]).toMatch(/outside/);
		});

		it("rejects overlapping merges", () => {
			expect(expectErrors(parseTableData({ rows, merges: ["A1:B2", "B1:C1"] }))).toEqual([
				'merges[1] "B1:C1" overlaps merge "A1:B2".',
			]);
		});
	});

	describe("styles", () => {
		const rows = [["a"]];

		it("rejects unknown style properties", () => {
			expect(
				expectErrors(parseTableData({ rows, styles: [{ range: "A1", background: "red" }] })),
			).toContain("styles[0] has unknown style `background`.");
		});

		it("requires a range", () => {
			expect(expectErrors(parseTableData({ rows, styles: [{ bold: true }] }))).toContain(
				'styles[0].range must be a range like "A1:B2".',
			);
		});

		it.each([
			["bg", "not a color!"],
			["fg", 123],
			["bold", "yes"],
			["italic", 1],
			["align", "justify"],
			["valign", "center"],
		])("rejects invalid %s value %j", (key, value) => {
			const errors = expectErrors(parseTableData({ rows, styles: [{ range: "A1", [key]: value }] }));
			expect(errors).toHaveLength(1);
			expect(errors[0]).toMatch(new RegExp(`^styles\\[0\\]\\.${key} must`));
		});

		it("reports every error at once", () => {
			const errors = expectErrors(
				parseTableData({ rows, styles: [{ range: "A1", bold: "x", align: "up" }, "oops"] }),
			);
			expect(errors).toHaveLength(3);
		});
	});
});

describe("isValidColor", () => {
	it.each([
		"#fff",
		"#ffff",
		"#1e3a8a",
		"#1e3a8a80",
		"red",
		"RebeccaPurple",
		"var(--color-red)",
		"rgb(255, 0, 0)",
		"rgba(255, 0, 0, 0.5)",
		"hsl(120deg 50% 50% / 0.5)",
		"rgba(var(--color-red-rgb), 0.2)",
		"rgba(var(--color-red-rgb),.5)",
	])("accepts %s", (color) => {
		expect(isValidColor(color)).toBe(true);
	});

	it.each([
		"",
		"#ff",
		"#fffff",
		"#ggg",
		"red; background: url(x)",
		"url(http://example.com)",
		"var(--x); color: red",
		"rgb(1,2,3) red",
		"expression(alert(1))",
		"rgba(var(--x), 0.2); color: red",
		"rgba(var(--x), 2)",
		"rgba(var(--x) red), 0.2)",
	])("rejects %j", (color) => {
		expect(isValidColor(color)).toBe(false);
	});
});
