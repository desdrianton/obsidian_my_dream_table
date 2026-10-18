import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
	CODE_BLOCK_LANGUAGE,
	createNumberedTable,
	isValidInsertSize,
	parseCodeBlock,
	toCodeBlock,
} from "../src/codeblock";

describe("parseCodeBlock", () => {
	it("parses hand-written YAML", () => {
		const source = [
			"rows:",
			"  - [Produk, Q1, Q2]",
			"  - [Laptop, 120, 140]",
			"merges: [B1:C1]",
			"styles:",
			"  - range: A1:C1",
			'    bg: "#eeeeee"',
			"    bold: true",
		].join("\n");
		const result = parseCodeBlock(source, load);
		if (!result.ok) throw new Error(result.errors.join("; "));
		expect(result.model.getCell(1, 1)).toBe("120");
		expect(result.model.getMergeAt(0, 2)).toEqual({ top: 0, left: 1, bottom: 0, right: 2 });
		expect(result.model.getStyle(0, 0)).toEqual({ bg: "#eeeeee", bold: true });
	});

	it("reports an empty block with a hint", () => {
		const result = parseCodeBlock("  \n", load);
		expect(result).toEqual({ ok: false, errors: [expect.stringMatching(/rows:/)] });
	});

	it("reports YAML syntax errors instead of throwing", () => {
		const result = parseCodeBlock("rows: [unclosed", load);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0]).toMatch(/^Invalid YAML: /);
	});

	it("handles parsers that throw non-Error values", () => {
		const result = parseCodeBlock("x", () => {
			throw "boom";
		});
		expect(result).toEqual({ ok: false, errors: ["Invalid YAML: boom"] });
	});

	it("passes schema errors through", () => {
		const result = parseCodeBlock("rows: [[a]]\nmerges: [A1]", load);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors[0]).toMatch(/more than one cell/);
	});
});

describe("toCodeBlock", () => {
	it("wraps the table in a fenced block that parses back to the same table", () => {
		const model = createNumberedTable(2, 3);
		model.merge({ top: 0, left: 1, bottom: 0, right: 2 });
		const block = toCodeBlock(model);

		expect(block.startsWith("```" + CODE_BLOCK_LANGUAGE + "\n")).toBe(true);
		expect(block.endsWith("\n```\n")).toBe(true);

		const inner = block.slice(block.indexOf("\n") + 1, block.lastIndexOf("```"));
		const result = parseCodeBlock(inner, load);
		if (!result.ok) throw new Error(result.errors.join("; "));
		expect(result.model.toData()).toEqual(model.toData());
	});
});

describe("createNumberedTable", () => {
	it("fills each cell with its row and column number", () => {
		const model = createNumberedTable(2, 3);
		expect(model.toData().rows).toEqual([
			["1_1", "1_2", "1_3"],
			["2_1", "2_2", "2_3"],
		]);
	});
});

describe("isValidInsertSize", () => {
	it("accepts whole numbers from 1 to the maximum", () => {
		expect(isValidInsertSize(1)).toBe(true);
		expect(isValidInsertSize(100)).toBe(true);
		expect(isValidInsertSize(0)).toBe(false);
		expect(isValidInsertSize(101)).toBe(false);
		expect(isValidInsertSize(2.5)).toBe(false);
		expect(isValidInsertSize(Number.NaN)).toBe(false);
	});
});
