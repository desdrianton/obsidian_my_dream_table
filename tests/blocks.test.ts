import { describe, expect, it } from "vitest";
import { findTableBlock } from "../src/blocks";

function at(lines: string[], line: number) {
	return findTableBlock((i) => lines[i]!, lines.length, line);
}

describe("findTableBlock", () => {
	const note = ["before", "```dreamtable", "rows:", '  - ["a"]', "```", "after"];

	it("finds the block from its fences and body", () => {
		for (const line of [1, 2, 3, 4]) expect(at(note, line)).toEqual({ lineStart: 1, lineEnd: 4 });
	});

	it("ignores lines outside the block", () => {
		expect(at(note, 0)).toBeNull();
		expect(at(note, 5)).toBeNull();
	});

	it("ignores other code blocks", () => {
		const lines = ["```js", "x", "```", "```", "y", "```"];
		for (let line = 0; line < lines.length; line++) expect(at(lines, line)).toBeNull();
	});

	it("does not reach past another block's fences", () => {
		const lines = ["```dreamtable", "rows: []", "```", "text", "```js", "x", "```"];
		expect(at(lines, 3)).toBeNull();
		expect(at(lines, 5)).toBeNull();
	});

	it("runs an unclosed block to the end of the note", () => {
		expect(at(["```dreamtable", "rows: []", "more"], 2)).toEqual({ lineStart: 0, lineEnd: 2 });
	});

	it("handles callouts and longer fences", () => {
		const lines = ["> [!note]", "> ````dreamtable", "> ```", "> ````", "> after"];
		expect(at(lines, 2)).toEqual({ lineStart: 1, lineEnd: 3 });
		expect(at(lines, 4)).toBeNull();
	});
});
