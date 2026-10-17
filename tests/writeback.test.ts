import { describe, expect, it } from "vitest";
import { applyLineEdit, bodyLineCount, planBodyEdit } from "../src/writeback";

function doc(...lines: string[]): string {
	return lines.join("\n");
}

/** Plans and applies an edit, returning the new document (or null). */
function rewrite(
	text: string,
	lineStart: number,
	lineEnd: number,
	expected: string,
	newBody: string,
): string | null {
	const edit = planBodyEdit(text.split("\n"), { lineStart, lineEnd }, expected, newBody);
	return edit && applyLineEdit(text, edit);
}

describe("planBodyEdit", () => {
	const note = doc("# Title", "", "```dreamtable", "rows:", '  - ["a"]', "```", "", "after");

	it("replaces only the body, keeping fences and surrounding text", () => {
		expect(rewrite(note, 2, 5, 'rows:\n  - ["a"]', 'rows:\n  - ["b"]\n  - ["c"]\n')).toBe(
			doc("# Title", "", "```dreamtable", "rows:", '  - ["b"]', '  - ["c"]', "```", "", "after"),
		);
	});

	it("returns whole-line edit coordinates", () => {
		const edit = planBodyEdit(note.split("\n"), { lineStart: 2, lineEnd: 5 }, 'rows:\n  - ["a"]\n', "x: 1\n");
		expect(edit).toEqual({ fromLine: 3, toLine: 5, text: "x: 1\n" });
	});

	it("ignores trailing newlines and CRLF when comparing", () => {
		expect(rewrite(note, 2, 5, 'rows:\r\n  - ["a"]\r\n\r\n', "x: 1")).not.toBeNull();
	});

	it("refuses when the body changed since it was rendered", () => {
		expect(rewrite(note, 2, 5, 'rows:\n  - ["OLD"]', "x: 1")).toBeNull();
	});

	it("refuses when the location does not point at a fenced block", () => {
		expect(rewrite(note, 0, 5, 'rows:\n  - ["a"]', "x: 1")).toBeNull(); // not a fence
		expect(rewrite(note, 2, 4, "rows:", "x: 1")).toBeNull(); // closing line is not a fence
		expect(rewrite(note, 2, 99, 'rows:\n  - ["a"]', "x: 1")).toBeNull();
		expect(rewrite(note, 5, 2, "", "x: 1")).toBeNull();
		expect(rewrite(note, -1, 5, "", "x: 1")).toBeNull();
	});

	it("handles tilde fences and longer backtick fences", () => {
		const tilde = doc("~~~dreamtable", "a: 1", "~~~");
		expect(rewrite(tilde, 0, 2, "a: 1", "b: 2")).toBe(doc("~~~dreamtable", "b: 2", "~~~"));

		const long = doc("````dreamtable", "a: 1", "````");
		expect(rewrite(long, 0, 2, "a: 1", "b: 2")).toBe(doc("````dreamtable", "b: 2", "````"));
		// A shorter fence cannot close a longer one.
		expect(rewrite(doc("````dreamtable", "a: 1", "```"), 0, 2, "a: 1", "b: 2")).toBeNull();
	});

	it("keeps the callout prefix on every line", () => {
		const callout = doc("> [!note]", "> ```dreamtable", "> rows:", ">", ">   - [a]", "> ```");
		expect(rewrite(callout, 1, 5, "rows:\n\n  - [a]", "rows:\n  - [b]\n\nend: 1")).toBe(
			doc("> [!note]", "> ```dreamtable", "> rows:", ">   - [b]", ">", "> end: 1", "> ```"),
		);
	});

	it("handles nested callouts", () => {
		const nested = doc("> > ```dreamtable", "> > a: 1", "> > ```");
		expect(rewrite(nested, 0, 2, "a: 1", "b: 2")).toBe(doc("> > ```dreamtable", "> > b: 2", "> > ```"));
	});

	it("keeps list indentation", () => {
		const list = doc("- item", "  ```dreamtable", "  a: 1", "", "  b: 2", "  ```");
		expect(rewrite(list, 1, 5, "a: 1\n\nb: 2", "c: 3")).toBe(
			doc("- item", "  ```dreamtable", "  c: 3", "  ```"),
		);
	});

	it("refuses when a body line has lost the block prefix", () => {
		const broken = doc("> ```dreamtable", "a: 1", "> ```");
		expect(rewrite(broken, 0, 2, "a: 1", "b: 2")).toBeNull();
	});

	it("handles an empty body", () => {
		const empty = doc("```dreamtable", "```");
		expect(rewrite(empty, 0, 1, "", "a: 1")).toBe(doc("```dreamtable", "a: 1", "```"));
	});
});

describe("bodyLineCount", () => {
	it("counts lines without trailing newlines", () => {
		expect(bodyLineCount("a\nb\n")).toBe(2);
		expect(bodyLineCount("a")).toBe(1);
	});
});
