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
