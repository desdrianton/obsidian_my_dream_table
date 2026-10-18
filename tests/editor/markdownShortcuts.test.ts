// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
	applyTextEdit,
	applyToTextarea,
	indentLines,
	insertLink,
	toggleMarker,
	type TextEdit,
} from "../../src/editor/markdownShortcuts";

/**
 * Runs an edit on text written with selection markers: `[` and `]` for a
 * selection, or `|` for a cursor. Returns the result in the same notation.
 */
function run(marked: string, fn: (state: { text: string; start: number; end: number }) => TextEdit): string {
	let start: number;
	let end: number;
	let text: string;
	if (marked.includes("|")) {
		start = end = marked.indexOf("|");
		text = marked.replace("|", "");
	} else {
		start = marked.indexOf("[");
		end = marked.indexOf("]") - 1;
		text = marked.replace("[", "").replace("]", "");
	}
	const edit = fn({ text, start, end });
	const out = applyTextEdit(text, edit);
	if (edit.selectionStart === edit.selectionEnd) {
		return out.slice(0, edit.selectionStart) + "|" + out.slice(edit.selectionStart);
	}
	return (
		out.slice(0, edit.selectionStart) +
		"[" +
		out.slice(edit.selectionStart, edit.selectionEnd) +
		"]" +
		out.slice(edit.selectionEnd)
	);
}

const bold = (s: string) => run(s, (state) => toggleMarker(state, "**"));
const italic = (s: string) => run(s, (state) => toggleMarker(state, "*"));
const link = (s: string) => run(s, insertLink);

describe("toggleMarker: bold", () => {
	it("wraps the selection and keeps it selected", () => {
		expect(bold("say [hello] world")).toBe("say **[hello]** world");
	});

	it("unwraps when the markers are just outside the selection", () => {
		expect(bold("say **[hello]** world")).toBe("say [hello] world");
	});

	it("unwraps when the selection includes the markers", () => {
		expect(bold("say [**hello**] world")).toBe("say [hello] world");
	});

	it("uses the word under the cursor", () => {
		expect(bold("say hel|lo world")).toBe("say **[hello]** world");
		expect(bold("say **hel|lo** world")).toBe("say [hello] world");
	});

	it("handles non-ASCII words", () => {
		expect(bold("kata ba|ŕu 漢字")).toBe("kata **[baŕu]** 漢字");
		expect(bold("漢|字")).toBe("**[漢字]**");
	});

	it("inserts an empty pair outside a word, and removes it again", () => {
		expect(bold("a | b")).toBe("a **|** b");
		expect(bold("a **|** b")).toBe("a | b");
		expect(bold("|")).toBe("**|**");
	});

	it("does not wrap surrounding whitespace", () => {
		expect(bold("say[ hello ]world")).toBe("say **[hello]** world");
	});

	it("unwraps bold inside bold-italic", () => {
		expect(bold("***[x]***")).toBe("*[x]*");
	});
});

describe("toggleMarker: italic", () => {
	it("wraps and unwraps", () => {
		expect(italic("[hi]")).toBe("*[hi]*");
		expect(italic("*[hi]*")).toBe("[hi]");
	});

	it("does not mistake bold for italic", () => {
		expect(italic("**[hi]**")).toBe("***[hi]***");
	});

	it("unwraps italic inside bold-italic", () => {
		expect(italic("***[hi]***")).toBe("**[hi]**");
	});
});

describe("insertLink", () => {
	it("uses selected text as the label and puts the cursor in the URL", () => {
		expect(link("see [docs] here")).toBe("see [docs](|) here");
	});

	it("uses a selected URL as the target and puts the cursor in the label", () => {
		expect(link("[https://obsidian.md]")).toBe("[|](https://obsidian.md)");
	});

	it("inserts an empty link at the cursor", () => {
		expect(link("go | now")).toBe("go [](|) now");
	});
});

describe("applyToTextarea", () => {
	it("replaces the text, sets the selection, and notifies listeners", () => {
		const textarea = document.createElement("textarea");
		document.body.appendChild(textarea);
		textarea.value = "say hello";
		let inputs = 0;
		textarea.addEventListener("input", () => inputs++);

		applyToTextarea(textarea, { from: 4, to: 9, insert: "**hello**", selectionStart: 6, selectionEnd: 11 });

		expect(textarea.value).toBe("say **hello**");
		expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([6, 11]);
		expect(inputs).toBe(1);
	});
});

const indent = (s: string) => run(s, (state) => indentLines(state, false)!);
const outdent = (s: string) => run(s, (state) => indentLines(state, true)!);

describe("indentLines", () => {
	it("indents a list item and keeps the cursor on its text", () => {
		expect(indent("- a\n- b|")).toBe("- a\n\t- b|");
		expect(indent("1. o|ne")).toBe("\t1. o|ne");
	});

	it("unindents tabs or up to four spaces", () => {
		expect(outdent("\t- b|")).toBe("- b|");
		expect(outdent("      - b|")).toBe("  - b|");
	});

	it("leaves lines that cannot be unindented", () => {
		expect(outdent("- b|")).toBe("- b|");
	});

	it("indents every selected line except empty ones", () => {
		expect(indent("[one\n\ntwo]")).toBe("\t[one\n\n\ttwo]");
	});

	it("does not include a line the selection only reaches the start of", () => {
		expect(indent("[- a\n]- b")).toBe("\t[- a\n]- b");
	});

	it("indents plain text too", () => {
		expect(indent("pl|ain")).toBe("\tpl|ain");
		expect(indent("|")).toBe("\t|");
	});
});
