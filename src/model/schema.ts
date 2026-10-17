import { formatRange, parseRange } from "./address";
import { isSingleCell, rangesIntersect } from "./range";
import {
	FORMAT_VERSION,
	BORDER_STYLES,
	MAX_BORDER_WIDTH,
	MAX_COLUMN_WIDTH,
	MAX_LINE_HEIGHT,
	MAX_PADDING,
	MIN_LINE_HEIGHT,
	MIN_BORDER_WIDTH,
	type Border,
	MIN_COLUMN_WIDTH,
	MIN_PADDING,
	type ColumnWidth,
	STYLE_KEYS,
	type CellStyle,
	type Range,
	type StyleKey,
	type StyleRule,
} from "./types";

/** Table content after validation, with ranges already parsed. */
export interface ParsedTable {
	rows: string[][];
	merges: Range[];
	styles: StyleRule[];
	/** One entry per column. */
	widths: ColumnWidth[];
	/** Table-wide default padding (px), or null for the theme default. */
	padding: number | null;
	/** Table-wide default border; empty for the theme default. */
	border: Border;
	/** Table-wide default line height, or null for the theme default. */
	lineHeight: number | null;
}

export type ParseResult =
	| { ok: true; table: ParsedTable }
	| { ok: false; errors: string[] };

const COLOR_PATTERNS = [
	/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
	/^[a-z]+$/i,
	/^var\(--[a-z0-9_-]+\)$/i,
	/^(?:rgb|rgba|hsl|hsla)\([0-9.,%\s/a-z]+\)$/i,
	// Theme color with opacity, e.g. rgba(var(--color-red-rgb), 0.2).
	/^rgba?\(var\(--[a-z0-9_-]+\)\s*,\s*(?:0|1|0?\.[0-9]+)\s*\)$/i,
];

export function isValidColor(value: string): boolean {
	return COLOR_PATTERNS.some((pattern) => pattern.test(value));
}

const ALIGN_VALUES = ["left", "center", "right"];
const VALIGN_VALUES = ["top", "middle", "bottom"];
const KNOWN_TOP_LEVEL_KEYS = new Set([
	"version",
	"rows",
	"merges",
	"styles",
	"widths",
	"padding",
	"border",
	"lineHeight",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the raw value of a table code block (typically the output of
 * Obsidian's `parseYaml`). Collects every error instead of stopping at the
 * first one, so the user can fix them all at once.
 */
export function parseTableData(input: unknown): ParseResult {
	const errors: string[] = [];

	if (!isPlainObject(input)) {
		return { ok: false, errors: ["Table must be an object with a `rows` field."] };
	}

	for (const key of Object.keys(input)) {
		if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
			errors.push(`Unknown field \`${key}\`.`);
		}
	}

	checkVersion(input.version, errors);
	const rows = parseRows(input.rows, errors);
	const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
	for (const row of rows) {
		while (row.length < colCount) row.push("");
	}

	const merges = parseMerges(input.merges, rows.length, colCount, errors);
	const styles = parseStyles(input.styles, errors);
	const widths = parseWidths(input.widths, colCount, errors);
	let padding: number | null = null;
	if (input.padding !== undefined && input.padding !== null) {
		if (isValidPadding(input.padding)) padding = input.padding;
		else errors.push(`\`padding\` ${PADDING_ERROR}`);
	}

	const border = parseBorder(input.border, errors);
	let lineHeight: number | null = null;
	if (input.lineHeight !== undefined && input.lineHeight !== null) {
		if (isValidLineHeight(input.lineHeight)) lineHeight = roundLineHeight(input.lineHeight);
		else errors.push(`\`lineHeight\` ${LINE_HEIGHT_ERROR}`);
	}

	if (errors.length > 0) {
		return { ok: false, errors };
	}
	return { ok: true, table: { rows, merges, styles, widths, padding, border, lineHeight } };
}

function checkVersion(version: unknown, errors: string[]): void {
	// A missing version is allowed so hand-written tables stay short.
	if (version === undefined) return;
	if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
		errors.push("`version` must be a positive integer.");
	} else if (version > FORMAT_VERSION) {
		errors.push(
			`Table uses format version ${version}, but this plugin only supports up to ${FORMAT_VERSION}. Please update the plugin.`,
		);
	}
}

function parseRows(value: unknown, errors: string[]): string[][] {
	if (!Array.isArray(value)) {
		errors.push("`rows` must be a list of rows.");
		return [];
	}
	return value.map((row, r) => {
		if (!Array.isArray(row)) {
			errors.push(`rows[${r}] must be a list of cells.`);
			return [];
		}
		return row.map((cell, c) => {
			// YAML turns `120` into a number and an empty item into null.
			if (cell === null || cell === undefined) return "";
			if (typeof cell === "string") return cell;
			if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
			errors.push(`rows[${r}][${c}] must be text, a number, or empty.`);
			return "";
		});
	});
}

function parseRangeField(value: unknown, path: string, errors: string[]): Range | null {
	if (typeof value !== "string") {
		errors.push(`${path} must be a range like "A1:B2".`);
		return null;
	}
	try {
		return parseRange(value);
	} catch {
		errors.push(`${path} has an invalid range "${value}".`);
		return null;
	}
}

function parseMerges(
	value: unknown,
	rowCount: number,
	colCount: number,
	errors: string[],
): Range[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) {
		errors.push("`merges` must be a list of ranges.");
		return [];
	}

	const merges: Range[] = [];
	value.forEach((item, i) => {
		const path = `merges[${i}]`;
		const range = parseRangeField(item, path, errors);
		if (!range) return;

		if (isSingleCell(range)) {
			errors.push(`${path} "${item}" must span more than one cell.`);
			return;
		}
		if (range.bottom >= rowCount || range.right >= colCount) {
			errors.push(`${path} "${item}" is outside the table.`);
			return;
		}
		const overlap = merges.find((other) => rangesIntersect(other, range));
		if (overlap) {
			errors.push(`${path} "${item}" overlaps merge "${formatRange(overlap)}".`);
			return;
		}
		merges.push(range);
	});
	return merges;
}

function parseWidths(value: unknown, colCount: number, errors: string[]): ColumnWidth[] {
	const widths: ColumnWidth[] = Array<ColumnWidth>(colCount).fill(null);
	if (value === undefined || value === null) return widths;
	if (!Array.isArray(value)) {
		errors.push("`widths` must be a list of column widths.");
		return widths;
	}
	if (value.length > colCount) {
		errors.push(`\`widths\` has ${value.length} entries but the table has only ${colCount} columns.`);
		return widths;
	}
	value.forEach((width, i) => {
		if (width === null) return;
		if (
			typeof width !== "number" ||
			!Number.isFinite(width) ||
			width < MIN_COLUMN_WIDTH ||
			width > MAX_COLUMN_WIDTH
		) {
			errors.push(
				`widths[${i}] must be a number from ${MIN_COLUMN_WIDTH} to ${MAX_COLUMN_WIDTH}, or null for automatic.`,
			);
			return;
		}
		widths[i] = Math.round(width);
	});
	return widths;
}

function parseStyles(value: unknown, errors: string[]): StyleRule[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) {
		errors.push("`styles` must be a list of style rules.");
		return [];
	}

	const rules: StyleRule[] = [];
	value.forEach((item, i) => {
		const path = `styles[${i}]`;
		if (!isPlainObject(item)) {
			errors.push(`${path} must be an object with a \`range\` field.`);
			return;
		}
		const range = parseRangeField(item.range, `${path}.range`, errors);
		const style: CellStyle = {};
		let valid = range !== null;

		for (const [key, prop] of Object.entries(item)) {
			if (key === "range") continue;
			if (!(STYLE_KEYS as readonly string[]).includes(key)) {
				errors.push(`${path} has unknown style \`${key}\`.`);
				valid = false;
				continue;
			}
			const error = validateStyleValue(key as StyleKey, prop);
			if (error) {
				errors.push(`${path}.${key} ${error}`);
				valid = false;
				continue;
			}
			(style as Record<string, unknown>)[key] =
				key === "lineHeight" && typeof prop === "number" ? roundLineHeight(prop) : prop;
		}

		if (valid && range) rules.push({ range, style });
	});
	return rules;
}

function parseBorder(value: unknown, errors: string[]): Border {
	if (value === undefined || value === null) return {};
	if (!isPlainObject(value)) {
		errors.push('`border` must be an object like { color: "#888888", width: 1, style: "solid" }.');
		return {};
	}
	const border: Border = {};
	for (const [key, prop] of Object.entries(value)) {
		if (prop === null || prop === undefined) continue;
		if (key === "color") {
			if (typeof prop === "string" && isValidColor(prop)) border.color = prop;
			else errors.push(`border.color ${COLOR_ERROR}`);
		} else if (key === "width") {
			if (isValidBorderWidth(prop)) border.width = prop;
			else errors.push(`border.width ${BORDER_WIDTH_ERROR}`);
		} else if (key === "style") {
			if (isBorderStyle(prop)) border.style = prop;
			else errors.push(`border.style ${BORDER_STYLE_ERROR}`);
		} else {
			errors.push(`border has unknown field \`${key}\`; use color, width, or style.`);
		}
	}
	return border;
}

const COLOR_ERROR = `must be a color like "#ff0000", "red", or "var(--color-red)".`;
const BORDER_WIDTH_ERROR = `must be a whole number of pixels from ${MIN_BORDER_WIDTH} to ${MAX_BORDER_WIDTH}.`;
const BORDER_STYLE_ERROR = `must be one of ${BORDER_STYLES.join(", ")}.`;

export function isValidBorderWidth(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= MIN_BORDER_WIDTH && (value as number) <= MAX_BORDER_WIDTH
	);
}

export function isBorderStyle(value: unknown): value is (typeof BORDER_STYLES)[number] {
	return (BORDER_STYLES as readonly unknown[]).includes(value);
}

const LINE_HEIGHT_ERROR = `must be a number from ${MIN_LINE_HEIGHT} to ${MAX_LINE_HEIGHT}, e.g. 1.5.`;

export function isValidLineHeight(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isFinite(value) &&
		value >= MIN_LINE_HEIGHT &&
		value <= MAX_LINE_HEIGHT
	);
}

/** Line heights are kept to two decimals so files stay tidy. */
export function roundLineHeight(value: number): number {
	return Math.round(value * 100) / 100;
}

const PADDING_ERROR = `must be a whole number of pixels from ${MIN_PADDING} to ${MAX_PADDING}.`;

export function isValidPadding(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= MIN_PADDING && (value as number) <= MAX_PADDING;
}

/** Returns an error message, or null if the value is acceptable. */
function validateStyleValue(key: StyleKey, value: unknown): string | null {
	if (value === null) return null;
	switch (key) {
		case "bg":
		case "fg":
		case "borderColor":
			return typeof value === "string" && isValidColor(value) ? null : COLOR_ERROR;
		case "borderWidth":
			return isValidBorderWidth(value) ? null : BORDER_WIDTH_ERROR;
		case "borderStyle":
			return isBorderStyle(value) ? null : BORDER_STYLE_ERROR;
		case "bold":
		case "italic":
			return typeof value === "boolean" ? null : "must be true or false.";
		case "align":
			return ALIGN_VALUES.includes(value as string)
				? null
				: `must be one of ${ALIGN_VALUES.join(", ")}.`;
		case "valign":
			return VALIGN_VALUES.includes(value as string)
				? null
				: `must be one of ${VALIGN_VALUES.join(", ")}.`;
		case "padding":
			return isValidPadding(value) ? null : PADDING_ERROR;
		case "lineHeight":
			return isValidLineHeight(value) ? null : LINE_HEIGHT_ERROR;
	}
}
