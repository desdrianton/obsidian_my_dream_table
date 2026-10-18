import { formatRange } from "./address";
import {
	isSingleCell,
	rangeContainsCell,
	rangeContainsRange,
	rangesEqual,
	rangesIntersect,
	shiftRangeForDelete,
	shiftRangeForInsert,
	unionRange,
	type Axis,
} from "./range";
import {
	isBorderStyle,
	isValidBorderWidth,
	isValidColor,
	isValidLineHeight,
	isValidPadding,
	mergeCrossesHeader,
	roundLineHeight,
	parseTableData,
	type ParsedTable,
} from "./schema";
import {
	FORMAT_VERSION,
	MAX_BORDER_WIDTH,
	MAX_COLUMN_WIDTH,
	MAX_LINE_HEIGHT,
	MAX_PADDING,
	MIN_LINE_HEIGHT,
	MIN_BORDER_WIDTH,
	type Border,
	type BorderStyle,
	MIN_COLUMN_WIDTH,
	MIN_PADDING,
	STYLE_KEYS,
	type ColumnWidth,
	type CellStyle,
	type Range,
	type ResolvedStyle,
	type StyleRule,
	type TableData,
} from "./types";

export type ModelResult = { ok: true; model: TableModel } | { ok: false; errors: string[] };

/**
 * In-memory table: a rectangular grid of markdown strings, plus merged
 * regions and an ordered list of style rules (later rules win).
 *
 * All editing operations go through this class so that merges and styles stay
 * consistent when rows or columns are inserted or deleted.
 */
export class TableModel {
	private rows: string[][];
	private mergeList: Range[];
	private styleRules: StyleRule[];
	private widths: ColumnWidth[];
	private defaultPadding: number | null;
	private defaultBorder: Border;
	private defaultLineHeight: number | null;
	private header: number;
	private isCollapsed: boolean;

	private constructor(table: ParsedTable) {
		this.rows = table.rows.map((row) => [...row]);
		this.mergeList = table.merges.map((m) => ({ ...m }));
		this.styleRules = table.styles.map((rule) => ({
			range: { ...rule.range },
			style: { ...rule.style },
		}));
		this.widths = [...table.widths];
		this.defaultPadding = table.padding;
		this.defaultBorder = { ...table.border };
		this.defaultLineHeight = table.lineHeight;
		this.header = table.header;
		this.isCollapsed = table.collapsed;
	}

	/** Builds a model from the raw (e.g. YAML-parsed) code block value. */
	static parse(input: unknown): ModelResult {
		const result = parseTableData(input);
		if (!result.ok) return result;
		return { ok: true, model: new TableModel(result.table) };
	}

	/** Creates an empty table of the given size. */
	static create(rowCount: number, colCount: number): TableModel {
		assertCount(rowCount, "rowCount");
		assertCount(colCount, "colCount");
		const rows = Array.from({ length: rowCount }, () => Array<string>(colCount).fill(""));
		const widths = Array<ColumnWidth>(colCount).fill(null);
		return new TableModel({
			rows,
			merges: [],
			styles: [],
			widths,
			padding: null,
			border: {},
			lineHeight: null,
			header: 0,
			collapsed: false,
		});
	}

	clone(): TableModel {
		return new TableModel({
			rows: this.rows,
			merges: this.mergeList,
			styles: this.styleRules,
			widths: this.widths,
			padding: this.defaultPadding,
			border: this.defaultBorder,
			lineHeight: this.defaultLineHeight,
			header: this.header,
			collapsed: this.isCollapsed,
		});
	}

	toData(): TableData {
		const data: TableData = {
			version: FORMAT_VERSION,
			rows: this.rows.map((row) => [...row]),
		};
		if (this.mergeList.length > 0) {
			data.merges = this.mergeList.map(formatRange);
		}
		if (this.styleRules.length > 0) {
			data.styles = this.styleRules.map((rule) => ({
				range: formatRange(rule.range),
				...rule.style,
			}));
		}
		if (this.hasColumnWidths) {
			// Trailing automatic columns need no entry.
			const widths = this.widths.slice(0, this.colCount);
			while (widths.length > 0 && widths[widths.length - 1] === null) widths.pop();
			data.widths = widths;
		}
		if (this.defaultPadding !== null) data.padding = this.defaultPadding;
		if (Object.keys(this.defaultBorder).length > 0) data.border = { ...this.defaultBorder };
		if (this.defaultLineHeight !== null) data.lineHeight = this.defaultLineHeight;
		if (this.header > 0) data.header = this.header;
		if (this.isCollapsed) data.collapsed = true;
		return data;
	}

	// ---------------------------------------------------------------- content

	get rowCount(): number {
		return this.rows.length;
	}

	get colCount(): number {
		return this.rows[0]?.length ?? 0;
	}

	getCell(row: number, col: number): string {
		this.assertCell(row, col);
		return this.rows[row]![col]!;
	}

	/** Sets a cell's markdown. Cells hidden under a merge cannot be written. */
	setCell(row: number, col: number, value: string): void {
		this.assertCell(row, col);
		if (this.isCovered(row, col)) {
			const merge = this.getMergeAt(row, col)!;
			throw new Error(
				`Cell is hidden by merge ${formatRange(merge)}; write to its top-left cell instead.`,
			);
		}
		this.rows[row]![col] = value;
	}

	// ----------------------------------------------------------------- merges

	get merges(): readonly Range[] {
		return this.mergeList.map((m) => ({ ...m }));
	}

	getMergeAt(row: number, col: number): Range | undefined {
		const merge = this.mergeList.find((m) => rangeContainsCell(m, row, col));
		return merge && { ...merge };
	}

	/** True for cells inside a merge other than its top-left (anchor) cell. */
	isCovered(row: number, col: number): boolean {
		const merge = this.mergeList.find((m) => rangeContainsCell(m, row, col));
		return merge !== undefined && (merge.top !== row || merge.left !== col);
	}

	/**
	 * Grows a range until no merge sticks out of it. Editors should call this
	 * on a selection before merging or styling, like spreadsheets do.
	 */
	expandToMerges(range: Range): Range {
		let result = { ...range };
		let changed = true;
		while (changed) {
			changed = false;
			for (const merge of this.mergeList) {
				if (rangesIntersect(result, merge) && !rangeContainsRange(result, merge)) {
					result = unionRange(result, merge);
					changed = true;
				}
			}
		}
		return result;
	}

	/**
	 * Merges a range into one cell. Existing merges inside the range are
	 * absorbed. As in spreadsheets, only the top-left cell's content is kept.
	 */
	merge(range: Range): void {
		this.assertRange(range);
		if (isSingleCell(range)) {
			throw new Error("Cannot merge a single cell.");
		}
		if (mergeCrossesHeader(range, this.header)) {
			throw new Error(`Cannot merge across the end of the header (row ${this.header}).`);
		}
		const partial = this.mergeList.find(
			(m) => rangesIntersect(m, range) && !rangeContainsRange(range, m),
		);
		if (partial) {
			throw new Error(
				`Range ${formatRange(range)} partially overlaps merge ${formatRange(partial)}; use expandToMerges() first.`,
			);
		}

		this.mergeList = this.mergeList.filter((m) => !rangeContainsRange(range, m));
		for (let r = range.top; r <= range.bottom; r++) {
			for (let c = range.left; c <= range.right; c++) {
				if (r !== range.top || c !== range.left) this.rows[r]![c] = "";
			}
		}
		this.mergeList.push({ ...range });
	}

	/** Removes every merge that touches the range. Returns how many were removed. */
	unmerge(range: Range): number {
		const before = this.mergeList.length;
		this.mergeList = this.mergeList.filter((m) => !rangesIntersect(m, range));
		return before - this.mergeList.length;
	}

	// ----------------------------------------------------------------- styles

	get styles(): readonly StyleRule[] {
		return this.styleRules.map((rule) => ({ range: { ...rule.range }, style: { ...rule.style } }));
	}

	/**
	 * Effective style of a cell after applying all rules in order. For merged
	 * cells, renderers should use the style of the anchor cell.
	 */
	getStyle(row: number, col: number): ResolvedStyle {
		const resolved: Record<string, unknown> = {};
		for (const rule of this.styleRules) {
			if (!rangeContainsCell(rule.range, row, col)) continue;
			for (const [key, value] of Object.entries(rule.style)) {
				if (value === null) delete resolved[key];
				else if (value !== undefined) resolved[key] = value;
			}
		}
		return resolved as ResolvedStyle;
	}

	/**
	 * Applies style properties to a range. `null` resets a property to the
	 * default. Earlier rules that become fully overridden are pruned so the
	 * stored rule list does not grow with every edit.
	 */
	applyStyle(range: Range, style: CellStyle): void {
		const keys = STYLE_KEYS.filter((key) => style[key] !== undefined);
		if (keys.length === 0) return;

		// Drop properties of earlier rules that the new rule overrides everywhere.
		this.styleRules = this.styleRules.filter((rule) => {
			if (!rangeContainsRange(range, rule.range)) return true;
			for (const key of keys) delete rule.style[key];
			return STYLE_KEYS.some((key) => rule.style[key] !== undefined);
		});

		// A reset is only needed if some remaining rule still sets that property here.
		const newStyle: CellStyle = {};
		for (const key of keys) {
			const value = style[key];
			const needed =
				value !== null ||
				this.styleRules.some(
					(rule) => rangesIntersect(rule.range, range) && rule.style[key] != null,
				);
			if (needed) (newStyle as Record<string, unknown>)[key] = value;
		}
		if (Object.keys(newStyle).length === 0) return;

		// Fold into the last rule when it targets the same range.
		const last = this.styleRules[this.styleRules.length - 1];
		if (last && rangesEqual(last.range, range)) {
			Object.assign(last.style, newStyle);
			return;
		}
		this.styleRules.push({ range: { ...range }, style: newStyle });
	}

	/** Resets every style property in the range back to the default. */
	clearStyle(range: Range): void {
		const reset: CellStyle = {};
		for (const key of STYLE_KEYS) (reset as Record<string, null>)[key] = null;
		this.applyStyle(range, reset);
	}

	// ----------------------------------------------------------------- header

	/** Number of rows at the top that form the header (0 for none). */
	get headerRows(): number {
		return this.header;
	}

	/**
	 * Makes the first `count` rows the header. Merges may not cross its end,
	 * since header and body are separate row groups. With no header left,
	 * the table can no longer be collapsed.
	 */
	setHeaderRows(count: number): void {
		assertIndex(count, this.rowCount, "Header row count");
		const crossing = this.mergeList.find((m) => mergeCrossesHeader(m, count));
		if (crossing) {
			throw new Error(`Merge ${formatRange(crossing)} crosses the end of the header; unmerge it first.`);
		}
		this.header = count;
		if (count === 0) this.isCollapsed = false;
	}

	/** Whether a header of `count` rows would cut through a merge. */
	canSetHeaderRows(count: number): boolean {
		return (
			Number.isInteger(count) &&
			count >= 0 &&
			count <= this.rowCount &&
			!this.mergeList.some((m) => mergeCrossesHeader(m, count))
		);
	}

	/** Whether the rows below the header are hidden. */
	get collapsed(): boolean {
		return this.isCollapsed;
	}

	set collapsed(collapsed: boolean) {
		if (collapsed && this.header === 0) throw new Error("Only a table with a header can be collapsed.");
		this.isCollapsed = collapsed;
	}

	/** Rows shown on screen: just the header while collapsed. */
	get visibleRowCount(): number {
		return this.isCollapsed ? this.header : this.rowCount;
	}

	// -------------------------------------------------------- column widths

	/** Width per column in px, or null where the width is automatic. */
	get columnWidths(): readonly ColumnWidth[] {
		return this.widths.slice(0, this.colCount);
	}

	get hasColumnWidths(): boolean {
		return this.columnWidths.some((w) => w !== null);
	}

	getColumnWidth(col: number): ColumnWidth {
		this.assertColumn(col);
		return this.widths[col] ?? null;
	}

	/** Sets a column's width in px (rounded and clamped), or null for automatic. */
	setColumnWidth(col: number, width: ColumnWidth): void {
		this.assertColumn(col);
		if (width !== null && !Number.isFinite(width)) {
			throw new RangeError(`Column width must be a finite number, got ${width}.`);
		}
		this.widths[col] =
			width === null ? null : Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
	}

	resetColumnWidths(): void {
		this.widths = this.widths.map(() => null);
	}

	// -------------------------------------------------------------- padding

	/** Default padding (px) for every cell, or null for the theme default. */
	get tablePadding(): number | null {
		return this.defaultPadding;
	}

	set tablePadding(padding: number | null) {
		if (padding !== null && !isValidPadding(padding)) {
			throw new RangeError(`Padding must be a whole number from ${MIN_PADDING} to ${MAX_PADDING}, got ${padding}.`);
		}
		this.defaultPadding = padding;
	}

	/** Padding (px) a cell is drawn with: its own style, else the table default. */
	getPadding(row: number, col: number): number | null {
		return this.getStyle(row, col).padding ?? this.defaultPadding;
	}

	// ---------------------------------------------------------- line height

	/** Default line height for every cell, or null for the theme default. */
	get tableLineHeight(): number | null {
		return this.defaultLineHeight;
	}

	set tableLineHeight(lineHeight: number | null) {
		if (lineHeight !== null && !isValidLineHeight(lineHeight)) {
			throw new RangeError(
				`Line height must be a number from ${MIN_LINE_HEIGHT} to ${MAX_LINE_HEIGHT}, got ${lineHeight}.`,
			);
		}
		this.defaultLineHeight = lineHeight === null ? null : roundLineHeight(lineHeight);
	}

	/** Line height a cell is drawn with: its own style, else the table default. */
	getLineHeight(row: number, col: number): number | null {
		return this.getStyle(row, col).lineHeight ?? this.defaultLineHeight;
	}

	// --------------------------------------------------------------- border

	/** Default border for every cell. Absent properties use the theme. */
	get tableBorder(): Border {
		return { ...this.defaultBorder };
	}

	/**
	 * Changes the table border. A value sets that property, null removes it
	 * (back to the theme), and an omitted property is left as it is.
	 */
	updateTableBorder(update: {
		color?: string | null;
		width?: number | null;
		style?: BorderStyle | null;
	}): void {
		const next: Border = { ...this.defaultBorder };
		if (update.color !== undefined) {
			if (update.color === null) delete next.color;
			else if (isValidColor(update.color)) next.color = update.color;
			else throw new RangeError(`Invalid border color: ${update.color}`);
		}
		if (update.width !== undefined) {
			if (update.width === null) delete next.width;
			else if (isValidBorderWidth(update.width)) next.width = update.width;
			else
				throw new RangeError(
					`Border width must be a whole number from ${MIN_BORDER_WIDTH} to ${MAX_BORDER_WIDTH}, got ${update.width}.`,
				);
		}
		if (update.style !== undefined) {
			if (update.style === null) delete next.style;
			else if (isBorderStyle(update.style)) next.style = update.style;
			else throw new RangeError(`Invalid border style: ${update.style}`);
		}
		this.defaultBorder = next;
	}

	/** Border a cell is drawn with: each property from its own style, else the table border. */
	getBorder(row: number, col: number): Border {
		const style = this.getStyle(row, col);
		const border: Border = {};
		const color = style.borderColor ?? this.defaultBorder.color;
		const width = style.borderWidth ?? this.defaultBorder.width;
		const borderStyle = style.borderStyle ?? this.defaultBorder.style;
		if (color !== undefined) border.color = color;
		if (width !== undefined) border.width = width;
		if (borderStyle !== undefined) border.style = borderStyle;
		return border;
	}

	// ---------------------------------------------------- rows and columns

	insertRows(index: number, count = 1): void {
		assertIndex(index, this.rowCount, "Row");
		assertPositive(count);
		const newRows = Array.from({ length: count }, () => Array<string>(this.colCount).fill(""));
		this.rows.splice(index, 0, ...newRows);
		this.shiftForInsert("row", index, count);
		if (index < this.header) this.header += count;
	}

	deleteRows(index: number, count = 1): void {
		assertPositive(count);
		assertIndex(index + count, this.rowCount, "Row");
		assertIndex(index, this.rowCount - 1, "Row");
		this.rows.splice(index, count);
		this.shiftForDelete("row", index, count);
		this.header -= Math.max(0, Math.min(this.header, index + count) - index);
		if (this.header === 0) this.isCollapsed = false;
	}

	insertColumns(index: number, count = 1): void {
		assertIndex(index, this.colCount, "Column");
		assertPositive(count);
		for (const row of this.rows) {
			row.splice(index, 0, ...Array<string>(count).fill(""));
		}
		this.widths.splice(index, 0, ...Array<ColumnWidth>(count).fill(null));
		this.shiftForInsert("col", index, count);
	}

	deleteColumns(index: number, count = 1): void {
		assertPositive(count);
		assertIndex(index + count, this.colCount, "Column");
		assertIndex(index, this.colCount - 1, "Column");
		for (const row of this.rows) row.splice(index, count);
		this.widths.splice(index, count);
		this.shiftForDelete("col", index, count);
	}

	private shiftForInsert(axis: Axis, index: number, count: number): void {
		this.mergeList = this.mergeList.map((m) => shiftRangeForInsert(m, axis, index, count));
		for (const rule of this.styleRules) {
			rule.range = shiftRangeForInsert(rule.range, axis, index, count);
		}
	}

	private shiftForDelete(axis: Axis, index: number, count: number): void {
		this.mergeList = this.mergeList
			.map((m) => shiftRangeForDelete(m, axis, index, count))
			.filter((m): m is Range => m !== null && !isSingleCell(m));
		this.styleRules = this.styleRules.flatMap((rule) => {
			const range = shiftRangeForDelete(rule.range, axis, index, count);
			return range ? [{ range, style: rule.style }] : [];
		});
	}

	// ------------------------------------------------------------- guards

	private assertCell(row: number, col: number): void {
		if (
			!Number.isInteger(row) ||
			!Number.isInteger(col) ||
			row < 0 ||
			col < 0 ||
			row >= this.rowCount ||
			col >= this.colCount
		) {
			throw new RangeError(
				`Cell (${row}, ${col}) is outside the ${this.rowCount}x${this.colCount} table.`,
			);
		}
	}

	private assertColumn(col: number): void {
		if (!Number.isInteger(col) || col < 0 || col >= this.colCount) {
			throw new RangeError(`Column ${col} is outside the table (0..${this.colCount - 1}).`);
		}
	}

	private assertRange(range: Range): void {
		if (range.top > range.bottom || range.left > range.right) {
			throw new RangeError("Range is not normalized (top/left must not exceed bottom/right).");
		}
		this.assertCell(range.top, range.left);
		this.assertCell(range.bottom, range.right);
	}
}

function assertIndex(index: number, max: number, label: string): void {
	if (!Number.isInteger(index) || index < 0 || index > max) {
		throw new RangeError(`${label} index ${index} is out of bounds (0..${max}).`);
	}
}

function assertPositive(count: number): void {
	if (!Number.isInteger(count) || count < 1) {
		throw new RangeError(`Count must be a positive integer, got ${count}.`);
	}
}

function assertCount(count: number, label: string): void {
	if (!Number.isInteger(count) || count < 0) {
		throw new RangeError(`${label} must be a non-negative integer, got ${count}.`);
	}
}
