import { CODE_BLOCK_LANGUAGE } from "./codeblock";
import { columnToLetters } from "./model/address";
import { serializeTable } from "./model/serialize";
import { FORMAT_VERSION, type HorizontalAlign, type StyleRuleData, type TableData } from "./model/types";
import type { BlockLocation } from "./writeback";

/** Callout (`>`) and indentation prefix shared by every line of a table. */
const PREFIX = /^(?:[ \t]*>)*[ \t]*/;
/** A delimiter row such as `| --- | :-: | --: |`. */
const DELIMITER_CELL = /^:?-+:?$/;
/** Line breaks written as HTML, the usual way to get several lines in a cell. */
const LINE_BREAK = /<br\s*\/?>/gi;

/** A markdown (pipe) table found in a note. */
export interface MarkdownTable {
	location: BlockLocation;
	/** Callout or indentation prefix of its lines, kept for the code block. */
	prefix: string;
}

/**
 * The markdown table covering `line` (0-based): a header row, a delimiter
 * row, and the rows below it up to the first line without a `|`.
 */
export function findMarkdownTable(
	getLine: (line: number) => string,
	lineCount: number,
	line: number,
): MarkdownTable | null {
	if (line < 0 || line >= lineCount) return null;
	const prefix = PREFIX.exec(getLine(line))![0];
	const content = (i: number): string | null => {
		const text = getLine(i);
		return text.startsWith(prefix) && PREFIX.exec(text)![0] === prefix ? text.slice(prefix.length) : null;
	};
	const isRow = (i: number) => {
		const text = content(i);
		return text !== null && text.includes("|");
	};
	if (!isRow(line)) return null;

	let first = line;
	while (first > 0 && isRow(first - 1)) first--;
	let last = line;
	while (last < lineCount - 1 && isRow(last + 1)) last++;

	// The header is the line just above the first delimiter row with as many cells.
	for (let i = first + 1; i <= last; i++) {
		const delimiter = parseDelimiter(content(i)!);
		if (!delimiter || splitRow(content(i - 1)!).length !== delimiter.length) continue;
		const lineStart = i - 1;
		return line >= lineStart ? { location: { lineStart, lineEnd: last }, prefix } : null;
	}
	return null;
}

/** Turns the lines of a markdown table (without their prefix) into table data. */
export function parseMarkdownTable(lines: readonly string[]): TableData | null {
	if (lines.length < 2) return null;
	const aligns = parseDelimiter(lines[1]!);
	if (!aligns) return null;

	const rows = [lines[0]!, ...lines.slice(2)].map((line) => splitRow(line).map(toCell));
	// Keep cells past the header's width instead of dropping their text.
	const width = Math.max(aligns.length, ...rows.map((row) => row.length));
	for (const row of rows) while (row.length < width) row.push("");

	const styles: StyleRuleData[] = [];
	aligns.forEach((align, col) => {
		if (!align) return;
		const letters = columnToLetters(col);
		styles.push({ range: `${letters}1:${letters}${rows.length}`, align });
	});

	const data: TableData = { version: FORMAT_VERSION, rows, header: 1 };
	if (styles.length > 0) data.styles = styles;
	return data;
}

/**
 * The dreamtable code block replacing the given markdown table lines, each
 * line starting with `prefix`; null if the lines are not a table.
 */
export function convertMarkdownTable(lines: readonly string[], prefix = ""): string | null {
	const data = parseMarkdownTable(lines.map((line) => line.slice(prefix.length)));
	if (!data) return null;
	const block = ["```" + CODE_BLOCK_LANGUAGE, ...serializeTable(data).trimEnd().split("\n"), "```"];
	return block.map((line) => prefix + line).join("\n");
}

/** Column alignments of a delimiter row, or null if the line is not one. */
function parseDelimiter(line: string): (HorizontalAlign | null)[] | null {
	const cells = splitRow(line);
	if (cells.length === 0 || !cells.every((cell) => DELIMITER_CELL.test(cell))) return null;
	return cells.map((cell) => {
		const left = cell.startsWith(":");
		const right = cell.endsWith(":");
		if (left && right) return "center";
		if (right) return "right";
		return left ? "left" : null;
	});
}

/** Raw cells of a table row, split on pipes that are not escaped. */
function splitRow(line: string): string[] {
	let text = line.trim();
	if (text.startsWith("|")) text = text.slice(1);
	if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
	const cells: string[] = [];
	let cell = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (ch === "\\" && text[i + 1] === "|") {
			cell += "\\|";
			i++;
		} else if (ch === "|") {
			cells.push(cell.trim());
			cell = "";
		} else {
			cell += ch;
		}
	}
	cells.push(cell.trim());
	return cells;
}

/**
 * Cell text as a dreamtable cell: pipes no longer need escaping (so
 * `[[note\|alias]]` becomes `[[note|alias]]`) and `<br>` becomes a line break.
 */
function toCell(raw: string): string {
	return raw.replace(/\\\|/g, "|").replace(LINE_BREAK, "\n");
}
