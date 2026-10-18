import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { parseCodeBlock } from "../src/codeblock";
import { convertMarkdownTable, findMarkdownTable, parseMarkdownTable } from "../src/convert";

function find(lines: string[], line: number) {
	return findMarkdownTable((i) => lines[i]!, lines.length, line);
}

describe("findMarkdownTable", () => {
	const note = ["intro", "| A | B |", "| --- | --- |", "| 1 | 2 |", "| 3 | 4 |", "", "after"];

	it("finds the table from any of its lines", () => {
		for (const line of [1, 2, 3, 4]) {
			expect(find(note, line)).toEqual({ location: { lineStart: 1, lineEnd: 4 }, prefix: "" });
		}
	});

	it("ignores lines outside the table", () => {
		for (const line of [0, 5, 6]) expect(find(note, line)).toBeNull();
	});

	it("needs a delimiter row with as many cells as the header", () => {
		expect(find(["| A | B |", "| 1 | 2 |"], 0)).toBeNull();
		expect(find(["| A | B |", "| --- |", "| 1 | 2 |"], 0)).toBeNull();
	});

	it("accepts tables without outer pipes", () => {
		expect(find(["A | B", "--- | ---", "1 | 2"], 2)?.location).toEqual({ lineStart: 0, lineEnd: 2 });
	});

	it("does not count a piped line above the header", () => {
		const lines = ["a | b | c", "| A | B |", "| - | - |", "| 1 | 2 |"];
		expect(find(lines, 3)?.location).toEqual({ lineStart: 1, lineEnd: 3 });
		expect(find(lines, 0)).toBeNull();
	});

	it("finds tables inside callouts", () => {
		const lines = ["> [!note]", "> | A |", "> | - |", "> | 1 |"];
		expect(find(lines, 2)).toEqual({ location: { lineStart: 1, lineEnd: 3 }, prefix: "> " });
	});
});

describe("parseMarkdownTable", () => {
	it("makes the first row the header", () => {
		expect(parseMarkdownTable(["| A | B |", "|---|---|", "| 1 | 2 |"])).toEqual({
			version: 1,
			rows: [
				["A", "B"],
				["1", "2"],
			],
			header: 1,
		});
	});

	it("turns column alignment into style rules", () => {
		const data = parseMarkdownTable(["| A | B | C | D |", "| :-- | :-: | --: | --- |", "| 1 | 2 | 3 | 4 |"]);
		expect(data?.styles).toEqual([
			{ range: "A1:A2", align: "left" },
			{ range: "B1:B2", align: "center" },
			{ range: "C1:C2", align: "right" },
		]);
	});

	it("unescapes pipes and turns <br> into line breaks", () => {
		const data = parseMarkdownTable(["| A |", "| - |", "| [[note\\|alias]] |", "| one<br>two<br/>three |"]);
		expect(data?.rows.slice(1)).toEqual([["[[note|alias]]"], ["one\ntwo\nthree"]]);
	});

	it("pads short rows and keeps extra cells", () => {
		const data = parseMarkdownTable(["| A | B |", "| - | - |", "| 1 |", "| 1 | 2 | 3 |"]);
		expect(data?.rows).toEqual([
			["A", "B", ""],
			["1", "", ""],
			["1", "2", "3"],
		]);
	});
});

describe("convertMarkdownTable", () => {
	it("writes a dreamtable block that parses back", () => {
		const block = convertMarkdownTable(["| Produk | Q1 |", "| --- | --: |", "| Laptop | 120 |"])!;
		const lines = block.split("\n");
		expect(lines[0]).toBe("```dreamtable");
		expect(lines[lines.length - 1]).toBe("```");
		const result = parseCodeBlock(lines.slice(1, -1).join("\n"), load);
		if (!result.ok) throw new Error(result.errors.join("; "));
		expect(result.model.getCell(1, 0)).toBe("Laptop");
		expect(result.model.getStyle(1, 1)).toEqual({ align: "right" });
	});

	it("keeps the callout prefix on every line", () => {
		const block = convertMarkdownTable(["> | A |", "> | - |"], "> ")!;
		for (const line of block.split("\n")) expect(line.startsWith("> ")).toBe(true);
	});
});
