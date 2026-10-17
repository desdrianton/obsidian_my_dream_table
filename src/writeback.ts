/** Position of a fenced code block in a document, as reported by Obsidian's getSectionInfo. */
export interface BlockLocation {
	/** Line of the opening fence (0-based). */
	lineStart: number;
	/** Line of the closing fence (0-based). */
	lineEnd: number;
}

/** Replacement of whole lines: lines [fromLine, toLine) become `text` (which ends with "\n"). */
export interface LineEdit {
	fromLine: number;
	toLine: number;
	text: string;
}

const OPENING_FENCE = /^((?:[ \t]*>)*[ \t]*)(`{3,}|~{3,})/;

/**
 * Plans the edit that replaces a code block's body with `newBody`.
 *
 * Returns null when the document no longer matches `expectedBody` at that
 * location (e.g. the note changed in another pane), so callers never
 * overwrite text they have not seen. Blocks inside callouts or lists keep
 * their line prefix (`> `, indentation).
 */
export function planBodyEdit(
	lines: readonly string[],
	location: BlockLocation,
	expectedBody: string,
	newBody: string,
): LineEdit | null {
	const { lineStart, lineEnd } = location;
	if (lineStart < 0 || lineEnd <= lineStart || lineEnd >= lines.length) return null;

	const opening = OPENING_FENCE.exec(lines[lineStart]!);
	if (!opening) return null;
	const prefix = opening[1]!;
	const fence = opening[2]!;

	const closing = stripPrefix(lines[lineEnd]!, prefix);
	if (closing === null || !closing.trim().startsWith(fence)) {
		return null;
	}

	const currentBody: string[] = [];
	for (let i = lineStart + 1; i < lineEnd; i++) {
		const stripped = stripPrefix(lines[i]!, prefix);
		if (stripped === null) return null;
		currentBody.push(stripped);
	}
	if (normalizeBody(currentBody.join("\n")) !== normalizeBody(expectedBody)) return null;

	const bodyLines = normalizeBody(newBody).split("\n");
	const text = bodyLines.map((line) => withPrefix(prefix, line)).join("\n") + "\n";
	return { fromLine: lineStart + 1, toLine: lineEnd, text };
}

/** Applies a line edit to full document text. */
export function applyLineEdit(docText: string, edit: LineEdit): string {
	const lines = docText.split("\n");
	const replacement = edit.text.slice(0, -1).split("\n");
	lines.splice(edit.fromLine, edit.toLine - edit.fromLine, ...replacement);
	return lines.join("\n");
}

/** Number of lines a body occupies once written. */
export function bodyLineCount(body: string): number {
	return normalizeBody(body).split("\n").length;
}

function normalizeBody(body: string): string {
	return body.replace(/\r\n/g, "\n").replace(/\n+$/, "");
}

/**
 * Removes the block's line prefix. Inside callouts, blank lines often lose
 * their trailing space ("> " becomes ">"), so a trimmed prefix also counts.
 */
function stripPrefix(line: string, prefix: string): string | null {
	if (line.startsWith(prefix)) return line.slice(prefix.length);
	if (line.trimEnd() === prefix.trimEnd()) return "";
	return null;
}

function withPrefix(prefix: string, line: string): string {
	return line === "" ? prefix.trimEnd() : prefix + line;
}
