import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import {
	CODE_BLOCK_LANGUAGE,
	createStarterTable,
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
		const model = createStarterTable();
		const block = toCodeBlock(model);

		expect(block.startsWith("```" + CODE_BLOCK_LANGUAGE + "\n")).toBe(true);
		expect(block.endsWith("\n```\n")).toBe(true);

		const inner = block.slice(block.indexOf("\n") + 1, block.lastIndexOf("```"));
		const result = parseCodeBlock(inner, load);
		if (!result.ok) throw new Error(result.errors.join("; "));
		expect(result.model.toData()).toEqual(model.toData());
	});
});

describe("createStarterTable", () => {
	it("showcases merges and styles", () => {
		const model = createStarterTable();
		expect(model.merges).toHaveLength(1);
		expect(model.getStyle(0, 0)).toMatchObject({ bold: true, align: "center" });
		expect(model.getStyle(2, 1)).toMatchObject({ align: "center", italic: true });
	});
});
