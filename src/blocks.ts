import { CODE_BLOCK_LANGUAGE } from "./codeblock";
import type { BlockLocation } from "./writeback";

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
