import { describe, expect, it } from "vitest";
import { preserveBlankLines } from "../../src/render/cellMarkdown";

const BLANK = "\n\n&nbsp;\n\n";

describe("preserveBlankLines", () => {
	it("leaves text without blank lines unchanged", () => {
		expect(preserveBlankLines("abc")).toBe("abc");
		expect(preserveBlankLines("abc\ndef")).toBe("abc\ndef");
		expect(preserveBlankLines("- [ ] a\n- [ ] b")).toBe("- [ ] a\n- [ ] b");
	});

	it("turns one blank line into one empty line", () => {
		expect(preserveBlankLines("a\n\nb")).toBe(`a${BLANK}b`);
	});

	it("keeps every blank line in a run", () => {
		expect(preserveBlankLines("a\n\n\nb")).toBe("a\n\n&nbsp;\n\n\n&nbsp;\n\nb");
		const lines = preserveBlankLines("a\n\n\nb").split("\n").filter((l) => l === "&nbsp;");
		expect(lines).toHaveLength(2);
	});

	it("keeps leading and trailing blank lines", () => {
		const count = (s: string) => s.split("\n").filter((l) => l === "&nbsp;").length;
		expect(count(preserveBlankLines("\nabc"))).toBe(1);
		expect(count(preserveBlankLines("abc\n\n\n"))).toBe(3);
	});

	it("treats whitespace-only lines as blank", () => {
		expect(preserveBlankLines("a\n   \nb")).toBe(`a${BLANK}b`);
	});

	it("normalizes CRLF", () => {
		expect(preserveBlankLines("a\r\n\r\nb")).toBe(`a${BLANK}b`);
	});

	it("leaves fenced code blocks alone", () => {
		const code = "```js\nconst a = 1;\n\n\nconst b = 2;\n```";
		expect(preserveBlankLines(code)).toBe(code);
		const tilde = "~~~\nx\n\ny\n~~~";
		expect(preserveBlankLines(tilde)).toBe(tilde);
	});

	it("resumes after a fence closes", () => {
		const out = preserveBlankLines("```\na\n\nb\n```\n\nafter");
		expect(out).toBe("```\na\n\nb\n```" + BLANK + "after");
	});

	it("does not close a fence with a shorter or different one", () => {
		const code = "````\n```\n\n~~~\n````";
		expect(preserveBlankLines(code)).toBe(code);
	});

	it("treats an unclosed fence as code to the end", () => {
		const code = "```\na\n\nb";
		expect(preserveBlankLines(code)).toBe(code);
	});
});
