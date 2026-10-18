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
	section: "merge" | "structure" | "header" | "freeze" | "delete" | "format";
	isEnabled?: (model: TableModel, range: Range) => boolean;
	isChecked?: (model: TableModel, range: Range) => boolean;
	run: (model: TableModel, range: Range) => Range | void;
	/**
	 * Runs the action on several ranges at once (a Ctrl/Cmd+click selection).
	 * Actions without it are disabled while more than one range is selected.
	 */
	runAll?: (model: TableModel, ranges: readonly Range[]) => void;
}

/** An action that also works on multi-range selections; `run` is `runAll` on one range. */
function multiRange(action: Omit<TableAction, "run" | "runAll"> & Required<Pick<TableAction, "runAll">>): TableAction {
	return { ...action, run: (model, range) => action.runAll(model, [range]) };
}

const rowCount = (range: Range) => range.bottom - range.top + 1;
const colCount = (range: Range) => range.right - range.left + 1;

/**
 * Toggling uses the top-left cell of the first range as the reference, like
 * most editors, so every range ends up the same.
 */
function toggle(key: "bold" | "italic") {
	return (model: TableModel, ranges: readonly Range[]) => {
		const first = ranges[0]!;
		const on = model.getStyle(first.top, first.left)[key] === true;
		for (const range of ranges) model.applyStyle(range, { [key]: on ? null : true });
	};
}

/** Subscript and superscript exclude each other; picking the active one turns it off. */
function toggleScript(value: Script) {
	return (model: TableModel, ranges: readonly Range[]) => {
		const first = ranges[0]!;
		const on = model.getStyle(first.top, first.left).script === value;
		for (const range of ranges) model.applyStyle(range, { script: on ? null : value });
	};
}

function align(value: HorizontalAlign) {
	return (model: TableModel, ranges: readonly Range[]) => {
		for (const range of ranges) model.applyStyle(range, { align: value === "left" ? null : value });
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
		id: "freeze-rows",
		title: "Freeze rows up to here",
		icon: "lock",
		section: "freeze",
		isEnabled: (model, range) => model.freezeRows !== range.bottom + 1,
		run: (model, range) => {
			model.freezeRows = range.bottom + 1;
			return range;
		},
	},
	{
		id: "freeze-cols",
		title: "Freeze columns up to here",
		icon: "lock",
		section: "freeze",
		isEnabled: (model, range) => model.freezeCols !== range.right + 1,
		run: (model, range) => {
			model.freezeCols = range.right + 1;
			return range;
		},
	},
	{
		id: "unfreeze",
		title: "Unfreeze rows and columns",
		icon: "lock-open",
		section: "freeze",
		isEnabled: (model) => model.freezeRows > 0 || model.freezeCols > 0,
		run: (model, range) => {
			model.freezeRows = 0;
			model.freezeCols = 0;
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
	multiRange({
		id: "clear-content",
		title: "Clear content",
		icon: "eraser",
		section: "delete",
		runAll: (model, ranges) => {
			for (const range of ranges) clearContent(model, range);
		},
	}),
	multiRange({
		id: "bold",
		title: "Bold",
		icon: "bold",
		section: "format",
		isChecked: (model, range) => model.getStyle(range.top, range.left).bold === true,
		runAll: toggle("bold"),
	}),
	multiRange({
		id: "italic",
		title: "Italic",
		icon: "italic",
		section: "format",
		isChecked: (model, range) => model.getStyle(range.top, range.left).italic === true,
		runAll: toggle("italic"),
	}),
	multiRange({
		id: "subscript",
		title: "Subscript",
		icon: "subscript",
		section: "format",
		isChecked: (model, range) => model.getStyle(range.top, range.left).script === "sub",
		runAll: toggleScript("sub"),
	}),
	multiRange({
		id: "superscript",
		title: "Superscript",
		icon: "superscript",
		section: "format",
		isChecked: (model, range) => model.getStyle(range.top, range.left).script === "sup",
		runAll: toggleScript("sup"),
	}),
	multiRange({
		id: "align-left",
		title: "Align left",
		icon: "align-left",
		section: "format",
		isChecked: alignChecked("left"),
		runAll: align("left"),
	}),
	multiRange({
		id: "align-center",
		title: "Align center",
		icon: "align-center",
		section: "format",
		isChecked: alignChecked("center"),
		runAll: align("center"),
	}),
	multiRange({
		id: "align-right",
		title: "Align right",
		icon: "align-right",
		section: "format",
		isChecked: alignChecked("right"),
		runAll: align("right"),
	}),
	multiRange({
		id: "clear-formatting",
		title: "Clear formatting",
		icon: "remove-formatting",
		section: "format",
		isEnabled: (model, range) => model.styles.some((rule) => rangesIntersect(rule.range, range)),
		runAll: (model, ranges) => {
			for (const range of ranges) model.clearStyle(range);
		},
	}),
];

/** Whether the action can run on the selected ranges (the first being the active one). */
export function isActionEnabled(action: TableAction, model: TableModel, ranges: readonly Range[]): boolean {
	if (ranges.length === 0 || (ranges.length > 1 && !action.runAll)) return false;
	if (!action.isEnabled) return true;
	return ranges.some((range) => action.isEnabled!(model, range));
}

/** Runs the action on the selected ranges; see `TableAction.run` for the result. */
export function runTableAction(action: TableAction, model: TableModel, ranges: readonly Range[]): Range | void {
	if (ranges.length === 1) return action.run(model, ranges[0]!);
	action.runAll!(model, ranges);
}

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
