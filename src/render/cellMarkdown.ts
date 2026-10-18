const FENCE = /^\s*(`{3,}|~{3,})/;
const BLANK = /^\s*$/;

/** An empty paragraph: renders as one blank line. */
const EMPTY_LINE = "&nbsp;";

/**
 * Makes every blank line in a cell visible, so the cell looks like what was
 * typed in its editor. Plain markdown would merge consecutive blank lines
 * into one paragraph break and drop leading and trailing ones.
 *
 * Each blank line becomes an empty paragraph. Lines inside fenced code blocks
 * are left alone, since code blocks already keep their blank lines.
 */
export function preserveBlankLines(markdown: string): string {
	const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
	const out: string[] = [];
	let fence: string | null = null;

	for (const line of lines) {
		const fenceMatch = FENCE.exec(line);
		if (fence !== null) {
			out.push(line);
			// A fence closes with the same character, at least as long.
			if (fenceMatch && fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length) {
				fence = null;
			}
			continue;
		}
		if (fenceMatch) {
			fence = fenceMatch[1]!;
			out.push(line);
			continue;
		}
		if (BLANK.test(line)) {
			// Blank lines around the marker keep it a paragraph of its own.
			out.push("", EMPTY_LINE, "");
			continue;
		}
		out.push(line);
	}
	return out.join("\n");
}

/** A task list item: list marker (optionally quoted), then `[c]` and a space or line end. */
const TASK = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)(.)(\](?:\s|$))/;

/**
 * Checks or unchecks the `index`-th task (counted in document order, as the
 * rendered checkboxes are) and returns the new markdown. Tasks inside fenced
 * code blocks are not counted, since they render as code. Returns the
 * markdown unchanged when there is no such task.
 */
export function setTaskChecked(markdown: string, index: number, checked: boolean): string {
	const lines = markdown.split("\n");
	let fence: string | null = null;
	let count = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const fenceMatch = FENCE.exec(line);
		if (fence !== null) {
			if (fenceMatch && fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length) {
				fence = null;
			}
			continue;
		}
		if (fenceMatch) {
			fence = fenceMatch[1]!;
			continue;
		}
		if (!TASK.test(line)) continue;
		if (count++ !== index) continue;
		lines[i] = line.replace(TASK, (_, before: string, _mark: string, after: string) => before + (checked ? "x" : " ") + after);
		return lines.join("\n");
	}
	return markdown;
}
