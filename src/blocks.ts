import { CODE_BLOCK_LANGUAGE } from "./codeblock";
import { planBodyEdit, type BlockLocation } from "./writeback";

/** Callout (`>`) and indentation prefix, then a fence and its info string. */
const FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})(.*)$/;

/**
 * The dreamtable code block covering `line` (0-based), fences included.
 * A block that is never closed runs to the end of the document, as in
 * Obsidian. Assumes code blocks do not nest.
 */
export function findTableBlock(
	getLine: (line: number) => string,
	lineCount: number,
	line: number,
): BlockLocation | null {
	let lineStart = -1;
	let fence = "";
	for (let i = line; i >= 0; i--) {
		const match = FENCE.exec(getLine(i));
		if (!match) continue;
		const info = match[2]!.trim();
		if (info.split(/\s/)[0] === CODE_BLOCK_LANGUAGE) {
			lineStart = i;
			fence = match[1]!;
			break;
		}
		// A bare fence on the line itself may be the closing fence of a table above.
		if (i === line && info === "") continue;
		return null;
	}
	if (lineStart < 0) return null;

	let lineEnd = lineCount - 1;
	for (let i = lineStart + 1; i < lineCount; i++) {
		const match = FENCE.exec(getLine(i));
		if (match && match[1]![0] === fence[0] && match[1]!.length >= fence.length && match[2]!.trim() === "") {
			lineEnd = i;
			break;
		}
	}
	return line <= lineEnd ? { lineStart, lineEnd } : null;
}

/**
 * Where the dreamtable block whose body is `expectedBody` is now. Text
 * typed above a table moves it without re-rendering it, so the location it
 * was rendered at goes stale. Prefers `hint`, then the matching block
 * nearest to it.
 */
export function locateTableBlock(
	lines: readonly string[],
	hint: BlockLocation,
	expectedBody: string,
): BlockLocation | null {
	const matches = (location: BlockLocation) => planBodyEdit(lines, location, expectedBody, expectedBody) !== null;
	if (matches(hint)) return hint;

	let best: BlockLocation | null = null;
	for (let i = 0; i < lines.length; i++) {
		const match = FENCE.exec(lines[i]!);
		if (!match || match[2]!.trim().split(/\s/)[0] !== CODE_BLOCK_LANGUAGE) continue;
		const block = findTableBlock((line) => lines[line]!, lines.length, i);
		if (!block) continue;
		if (matches(block) && (!best || Math.abs(block.lineStart - hint.lineStart) < Math.abs(best.lineStart - hint.lineStart))) {
			best = block;
		}
		i = block.lineEnd;
	}
	return best;
}
