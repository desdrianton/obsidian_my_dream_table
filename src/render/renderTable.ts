import type { TableModel } from "../model/TableModel";
import type { Border, ColumnWidth, ResolvedStyle } from "../model/types";
import { preserveBlankLines } from "./cellMarkdown";

/** Renders a cell's markdown into the element (e.g. via Obsidian's MarkdownRenderer). */
export type RenderMarkdown = (markdown: string, el: HTMLElement) => Promise<void>;

export const CLASS_PREFIX = "dream-table";

/** CSS variable carrying a cell's line height to the blocks inside it (see styles.css). */
export const LINE_HEIGHT_VAR = "--dream-table-line-height";

/** Width (px) used for automatic columns once other columns have a fixed width. */
export const DEFAULT_COLUMN_WIDTH = 120;

/**
 * Called when the header's collapse button is clicked. Without it the button
 * only toggles the table on screen (e.g. for read-only tables).
 */
export type ToggleCollapse = () => void;

/**
 * Builds a `<table>` for the model inside `container`. Merged regions become
 * a single cell with rowspan/colspan; cells hidden under a merge are skipped.
 * Header rows go into a `<thead>` whose first cell holds the button that
 * collapses the body. Resolves once every cell's markdown has rendered.
 */
export async function renderTable(
	model: TableModel,
	container: HTMLElement,
	renderMarkdown: RenderMarkdown,
	onToggleCollapse?: ToggleCollapse,
): Promise<HTMLTableElement> {
	const doc = container.ownerDocument;
	const wrapper = doc.createElement("div");
	wrapper.className = `${CLASS_PREFIX}-wrapper`;
	const table = doc.createElement("table");
	table.className = CLASS_PREFIX;
	const colgroup = doc.createElement("colgroup");
	for (let col = 0; col < model.colCount; col++) {
		const colEl = doc.createElement("col");
		colEl.dataset.col = String(col);
		colgroup.appendChild(colEl);
	}
	table.appendChild(colgroup);
	applyColumnWidths(table, model.columnWidths);
	const header = model.headerRows;
	const thead = header > 0 ? doc.createElement("thead") : null;
	const tbody = doc.createElement("tbody");
	if (thead) table.appendChild(thead);
	table.appendChild(tbody);
	table.classList.toggle("is-collapsed", header > 0 && model.collapsed);
	wrapper.appendChild(table);
	container.appendChild(wrapper);

	const pending: Promise<void>[] = [];
	for (let row = 0; row < model.rowCount; row++) {
		const tr = doc.createElement("tr");
		for (let col = 0; col < model.colCount; col++) {
			if (model.isCovered(row, col)) continue;

			const td = doc.createElement("td");
			td.dataset.row = String(row);
			td.dataset.col = String(col);
			const merge = model.getMergeAt(row, col);
			if (merge) {
				td.rowSpan = merge.bottom - merge.top + 1;
				td.colSpan = merge.right - merge.left + 1;
			}
			// Padding, line height and font are resolved per cell (own style, else
			// the table default) and set inline, so theme rules cannot override them.
			const style = { ...model.getStyle(row, col) };
			const padding = model.getPadding(row, col);
			const lineHeight = model.getLineHeight(row, col);
			const fontSize = model.getFontSize(row, col);
			const fontFamily = model.getFontFamily(row, col);
			if (padding !== null) style.padding = padding;
			if (lineHeight !== null) style.lineHeight = lineHeight;
			if (fontSize !== null) style.fontSize = fontSize;
			if (fontFamily !== null) style.fontFamily = fontFamily;
			applyCellStyle(td, style);
			applyCellBorder(td, model.getBorder(row, col));

			const content = model.getCell(row, col);
			if (content !== "") pending.push(renderMarkdown(preserveBlankLines(content), td));
			tr.appendChild(td);
		}
		(row < header ? thead! : tbody).appendChild(tr);
	}

	await Promise.all(pending);
	// Added last so rendering the cell's markdown cannot replace it.
	const first = thead?.querySelector<HTMLTableCellElement>("td[data-row='0'][data-col='0']");
	first?.prepend(createCollapseButton(table, onToggleCollapse));
	return table;
}

/** Chevron that hides or shows the body rows. */
function createCollapseButton(table: HTMLTableElement, onToggle?: ToggleCollapse): HTMLButtonElement {
	const doc = table.ownerDocument;
	const button = doc.createElement("button");
	button.type = "button";
	button.className = `${CLASS_PREFIX}-collapse`;
	// Focus stays on the table, so its keyboard handling keeps working.
	button.tabIndex = -1;
	const sync = () => {
		const collapsed = table.classList.contains("is-collapsed");
		button.setAttribute("aria-expanded", String(!collapsed));
		button.setAttribute("aria-label", collapsed ? "Expand table" : "Collapse table");
	};
	sync();
	// Keep presses from selecting or editing the cell, or moving the note's cursor.
	const swallow = (evt: Event) => {
		evt.preventDefault();
		evt.stopPropagation();
	};
	button.addEventListener("mousedown", swallow);
	button.addEventListener("dblclick", swallow);
	button.addEventListener("click", (evt) => {
		swallow(evt);
		if (onToggle) {
			onToggle();
			return;
		}
		table.classList.toggle("is-collapsed");
		sync();
	});
	return button;
}

/**
 * Sizes the table's columns. With no widths set the browser sizes columns to
 * their content; otherwise the layout is fixed so the widths are respected
 * exactly, and automatic columns get DEFAULT_COLUMN_WIDTH.
 */
export function applyColumnWidths(table: HTMLTableElement, widths: readonly ColumnWidth[]): void {
	const cols = Array.from(table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col"));
	const fixed = widths.some((w) => w !== null);
	let total = 0;
	cols.forEach((col, i) => {
		const width = widths[i] ?? DEFAULT_COLUMN_WIDTH;
		total += width;
		col.style.width = fixed ? `${width}px` : "";
	});
	table.style.tableLayout = fixed ? "fixed" : "";
	table.style.width = fixed ? `${total}px` : "";
	table.classList.toggle("has-fixed-widths", fixed);
}

/**
 * Sets the resolved border inline (so theme rules cannot override it). Only
 * the properties that are set are written; the rest come from styles.css.
 * "none" is drawn as `hidden`: with collapsed borders, `none` would still
 * show a neighbouring cell's border on the shared edge.
 */
export function applyCellBorder(el: HTMLElement, border: Border): void {
	if (border.width !== undefined) el.style.borderWidth = `${border.width}px`;
	if (border.style !== undefined) el.style.borderStyle = border.style === "none" ? "hidden" : border.style;
	if (border.color !== undefined) el.style.borderColor = border.color;
}

/**
 * Applies a resolved style through the CSSOM rather than a style attribute
 * string, so a value can never inject extra declarations.
 */
export function applyCellStyle(el: HTMLElement, style: ResolvedStyle): void {
	if (style.bg) el.style.backgroundColor = style.bg;
	if (style.fg) el.style.color = style.fg;
	if (style.bold) el.style.fontWeight = "bold";
	if (style.italic) el.style.fontStyle = "italic";
	if (style.align) el.style.textAlign = style.align;
	if (style.valign) el.style.verticalAlign = style.valign;
	if (style.padding !== undefined) el.style.padding = `${style.padding}px`;
	if (style.lineHeight !== undefined) {
		el.style.lineHeight = String(style.lineHeight);
		// Also handed to paragraphs and list items inside, which themes may style directly.
		el.style.setProperty(LINE_HEIGHT_VAR, String(style.lineHeight));
		el.classList.add("has-line-height");
	}
	if (style.fontSize !== undefined) el.style.fontSize = `${style.fontSize}px`;
	if (style.fontFamily !== undefined) {
		el.style.fontFamily = style.fontFamily;
		// Headings inside otherwise keep the theme's heading font.
		el.classList.add("has-font-family");
	}
	// Not `vertical-align`, which the cell already uses for `valign`.
	if (style.script) el.classList.add(`is-${style.script}`);
}

/** Shows parse errors in place of the table. */
export function renderErrors(container: HTMLElement, errors: readonly string[]): void {
	const doc = container.ownerDocument;
	const box = doc.createElement("div");
	box.className = `${CLASS_PREFIX}-error`;

	const title = doc.createElement("strong");
	title.textContent = "Dream Table: cannot render this table";
	box.appendChild(title);

	const list = doc.createElement("ul");
	for (const error of errors) {
		const li = doc.createElement("li");
		li.textContent = error;
		list.appendChild(li);
	}
	box.appendChild(list);
	container.appendChild(box);
}
