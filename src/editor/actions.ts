import { isSingleCell, rangesEqual, rangesIntersect } from "../model/range";
import type { TableModel } from "../model/TableModel";
import { roundLineHeight } from "../model/schema";
import type { BorderStyle, CellStyle, HorizontalAlign, Range, Script } from "../model/types";

/**
 * A context-menu command on the selected range. `run` mutates the model and
 * may return the range to select afterwards.
 */
export interface TableAction {
	id: string;
	title: string;
	icon: string;
	section: "merge" | "structure" | "header" | "delete" | "format";
	isEnabled?: (model: TableModel, range: Range) => boolean;
	isChecked?: (model: TableModel, range: Range) => boolean;
	run: (model: TableModel, range: Range) => Range | void;
}

const rowCount = (range: Range) => range.bottom - range.top + 1;
const colCount = (range: Range) => range.right - range.left + 1;

/** Toggling uses the top-left cell as the reference, like most editors. */
function toggle(key: "bold" | "italic") {
	return (model: TableModel, range: Range) => {
		const on = model.getStyle(range.top, range.left)[key] === true;
		model.applyStyle(range, { [key]: on ? null : true });
	};
}

/** Subscript and superscript exclude each other; picking the active one turns it off. */
function toggleScript(value: Script) {
	return (model: TableModel, range: Range) => {
		const on = model.getStyle(range.top, range.left).script === value;
		model.applyStyle(range, { script: on ? null : value });
	};
}

function align(value: HorizontalAlign) {
	return (model: TableModel, range: Range) => {
		model.applyStyle(range, { align: value === "left" ? null : value });
	};
}

function alignChecked(value: HorizontalAlign) {
	return (model: TableModel, range: Range) =>
		(model.getStyle(range.top, range.left).align ?? "left") === value;
}

export const TABLE_ACTIONS: readonly TableAction[] = [
	{
		id: "merge",
		title: "Merge cells",
		icon: "combine",
		section: "merge",
		isEnabled: (model, range) =>
			!isSingleCell(range) && !model.merges.some((m) => rangesEqual(m, range)),
		run: (model, range) => {
			model.merge(range);
			return range;
		},
	},
	{
		id: "unmerge",
		title: "Unmerge cells",
		icon: "split",
		section: "merge",
		isEnabled: (model, range) => model.merges.some((m) => rangesIntersect(m, range)),
		run: (model, range) => {
			model.unmerge(range);
			return range;
		},
	},
	{
		id: "insert-row-above",
		title: "Insert row above",
		icon: "arrow-up-to-line",
		section: "structure",
		run: (model, range) => {
			model.insertRows(range.top);
			return { top: range.top, bottom: range.top, left: range.left, right: range.left };
		},
	},
	{
		id: "insert-row-below",
		title: "Insert row below",
		icon: "arrow-down-to-line",
		section: "structure",
		run: (model, range) => {
			model.insertRows(range.bottom + 1);
			const row = range.bottom + 1;
			return { top: row, bottom: row, left: range.left, right: range.left };
		},
	},
	{
		id: "insert-column-left",
		title: "Insert column left",
		icon: "arrow-left-to-line",
		section: "structure",
		run: (model, range) => {
			model.insertColumns(range.left);
			return { top: range.top, bottom: range.top, left: range.left, right: range.left };
		},
	},
	{
		id: "insert-column-right",
		title: "Insert column right",
		icon: "arrow-right-to-line",
		section: "structure",
		run: (model, range) => {
			model.insertColumns(range.right + 1);
			const col = range.right + 1;
			return { top: range.top, bottom: range.top, left: col, right: col };
		},
	},
	{
		id: "reset-widths",
		title: "Reset column widths",
		icon: "move-horizontal",
		section: "structure",
		isEnabled: (model) => model.hasColumnWidths,
		run: (model, range) => {
			model.resetColumnWidths();
			return range;
		},
	},
	{
		id: "set-header",
		title: "Make header (rows up to here)",
		icon: "panel-top",
		section: "header",
		isEnabled: (model, range) =>
			model.headerRows !== range.bottom + 1 && model.canSetHeaderRows(range.bottom + 1),
		run: (model, range) => {
			model.setHeaderRows(range.bottom + 1);
			return range;
		},
	},
	{
		id: "remove-header",
		title: "Remove header",
		icon: "panel-top-close",
		section: "header",
		isEnabled: (model) => model.headerRows > 0,
		run: (model, range) => {
			model.setHeaderRows(0);
			return range;
		},
	},
	{
		id: "toggle-collapse",
		title: "Collapse table",
		icon: "chevrons-down-up",
		section: "header",
		isEnabled: (model) => model.headerRows > 0,
		isChecked: (model) => model.collapsed,
		run: (model, range) => {
			model.collapsed = !model.collapsed;
			return range;
		},
	},
	{
		id: "delete-rows",
		title: "Delete row",
		icon: "trash-2",
		section: "delete",
		// Keep at least one row so the table never disappears.
		isEnabled: (model, range) => rowCount(range) < model.rowCount,
		run: (model, range) => {
			model.deleteRows(range.top, rowCount(range));
			return collapseTo(model, range.top, range.left);
		},
	},
	{
		id: "delete-columns",
		title: "Delete column",
		icon: "trash-2",
		section: "delete",
		isEnabled: (model, range) => colCount(range) < model.colCount,
		run: (model, range) => {
			model.deleteColumns(range.left, colCount(range));
			return collapseTo(model, range.top, range.left);
		},
	},
	{
		id: "clear-content",
		title: "Clear content",
		icon: "eraser",
		section: "delete",
		run: (model, range) => {
			clearContent(model, range);
			return range;
		},
	},
	{
		id: "bold",
		title: "Bold",
		icon: "bold",
		section: "format",
		isChecked: (model, range) => model.getStyle(range.top, range.left).bold === true,
		run: toggle("bold"),
	},
	{
		id: "italic",
		title: "Italic",
		icon: "italic",
		section: "format",
		isChecked: (model, range) => model.getStyle(range.top, range.left).italic === true,
		run: toggle("italic"),
	},
	{
		id: "subscript",
		title: "Subscript",
		icon: "subscript",
		section: "format",
		isChecked: (model, range) => model.getStyle(range.top, range.left).script === "sub",
		run: toggleScript("sub"),
	},
	{
		id: "superscript",
		title: "Superscript",
		icon: "superscript",
		section: "format",
		isChecked: (model, range) => model.getStyle(range.top, range.left).script === "sup",
		run: toggleScript("sup"),
	},
	{
		id: "align-left",
		title: "Align left",
		icon: "align-left",
		section: "format",
		isChecked: alignChecked("left"),
		run: align("left"),
	},
	{
		id: "align-center",
		title: "Align center",
		icon: "align-center",
		section: "format",
		isChecked: alignChecked("center"),
		run: align("center"),
	},
	{
		id: "align-right",
		title: "Align right",
		icon: "align-right",
		section: "format",
		isChecked: alignChecked("right"),
		run: align("right"),
	},
	{
		id: "clear-formatting",
		title: "Clear formatting",
		icon: "remove-formatting",
		section: "format",
		isEnabled: (model, range) => model.styles.some((rule) => rangesIntersect(rule.range, range)),
		run: (model, range) => model.clearStyle(range),
	},
];

/** Empties every writable cell in the range (merge anchors and plain cells). */
export function clearContent(model: TableModel, range: Range): void {
	for (let row = range.top; row <= range.bottom; row++) {
		for (let col = range.left; col <= range.right; col++) {
			if (!model.isCovered(row, col)) model.setCell(row, col, "");
		}
	}
}

/** Sets or (with null) removes a color on a range. */
export function setColor(model: TableModel, range: Range, key: "bg" | "fg", color: string | null): void {
	const style: CellStyle = { [key]: color };
	model.applyStyle(range, style);
}

/** Sets or (with null) removes the cell padding override on a range. */
export function setPadding(model: TableModel, range: Range, padding: number | null): void {
	model.applyStyle(range, { padding });
}

/** Sets or (with null) removes the line height override on a range. */
export function setLineHeight(model: TableModel, range: Range, lineHeight: number | null): void {
	model.applyStyle(range, { lineHeight: lineHeight === null ? null : roundLineHeight(lineHeight) });
}

/** Sets or (with null) removes the font size override on a range. */
export function setFontSize(model: TableModel, range: Range, fontSize: number | null): void {
	model.applyStyle(range, { fontSize });
}

/** Sets or (with null) removes the font family override on a range. */
export function setFontFamily(model: TableModel, range: Range, fontFamily: string | null): void {
	model.applyStyle(range, { fontFamily: fontFamily === null ? null : fontFamily.trim() });
}

/** Sets the cell border override on a range; null properties fall back to the table border. */
export function setBorder(
	model: TableModel,
	range: Range,
	border: { color: string | null; width: number | null; style: BorderStyle | null },
): void {
	model.applyStyle(range, {
		borderColor: border.color,
		borderWidth: border.width,
		borderStyle: border.style,
	});
}

/** A single-cell range at the given position, clamped to the table. */
function collapseTo(model: TableModel, row: number, col: number): Range {
	const r = Math.min(row, model.rowCount - 1);
	const c = Math.min(col, model.colCount - 1);
	return { top: r, bottom: r, left: c, right: c };
}
