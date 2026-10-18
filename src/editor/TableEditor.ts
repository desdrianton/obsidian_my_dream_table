import { normalizeRange } from "../model/address";
import { rangeContainsCell, rangesEqual } from "../model/range";
import type { TableModel } from "../model/TableModel";
import type { CellRef, Range } from "../model/types";
import { appendToCell, imageFilesFrom } from "../images";
import { setTaskChecked } from "../render/cellMarkdown";
import { applyColumnWidths, renderTable, type RenderMarkdown } from "../render/renderTable";
import { clearContent, isActionEnabled, runTableAction, TABLE_ACTIONS } from "./actions";
import {
	applyToTextarea,
	indentLines,
	insertLink,
	toggleMarker,
	type TextEdit,
	type TextState,
} from "./markdownShortcuts";
import { hitColumnEdge, measureColumnWidths, resizedWidths, startingWidths } from "./resize";

export interface Selection {
	anchor: CellRef;
	focus: CellRef;
	/** Ranges added earlier with Ctrl/Cmd+click, besides the active anchor–focus range. */
	extra?: Range[];
}

/** What survives a re-render (e.g. after the note is rewritten). */
export interface EditorState {
	selection: Selection | null;
	/** Whether the table had keyboard focus, so a re-created editor can take it back. */
	focused?: boolean;
	/** How far the table's own box was scrolled (wide tables, frozen rows). */
	scroll?: { top: number; left: number };
	/** A cell edit in progress: its unsaved text and the textarea's selection. */
	editing?: { cell: CellRef; text: string; start: number; end: number };
}

export interface TableEditorOptions {
	renderMarkdown: RenderMarkdown;
	/** Persists a changed model. Resolve false to roll the change back. */
	onChange: (model: TableModel, state: EditorState) => Promise<boolean>;
	/** `ranges` are the selected ranges, the active one first (see `getSelectedRanges`). */
	onContextMenu?: (evt: MouseEvent, ranges: Range[]) => void;
	onError?: (error: unknown) => void;
	/**
	 * Called when keyboard focus enters or leaves the table (including the
	 * cell editor). Hosts use it to route their own hotkeys to the table,
	 * e.g. so Ctrl+B formats the cell instead of the surrounding note.
	 */
	onFocusChange?: (focused: boolean) => void;
	/**
	 * Stores image files pasted or dropped onto the table and returns the
	 * markdown to insert for each (e.g. `![[Pasted image.png]]`). Without
	 * it, image pastes and drops are left to the browser.
	 */
	onInsertFiles?: (files: File[]) => Promise<string[]>;
	/**
	 * Clicking outside the table clears the selection, except on elements
	 * this returns true for, e.g. the host's menus and dialogs that act on it.
	 */
	keepsSelection?: (target: Element) => boolean;
	/**
	 * Called when an arrow key moves past the table's edge: up from the top
	 * row or left from the first cell ("before"), down from the bottom row or
	 * right from the last cell ("after"). The host moves its cursor out of
	 * the table and returns true, or returns false to stay in the table.
	 */
	onExit?: (side: "before" | "after") => boolean;
	initialState?: EditorState;
}

function sameAnchor(model: TableModel, a: CellRef, b: CellRef): boolean {
	const x = snapToAnchor(model, a);
	const y = snapToAnchor(model, b);
	return x.row === y.row && x.col === y.col;
}

/** Top-left cell of the merge containing (row, col), or the cell itself. */
export function snapToAnchor(model: TableModel, cell: CellRef): CellRef {
	const merge = model.getMergeAt(cell.row, cell.col);
	return merge ? { row: merge.top, col: merge.left } : { ...cell };
}

/**
 * The cell reached by one step from `from`, jumping over the merge it sits
 * in and stopping at the table edge.
 */
export function stepFrom(model: TableModel, from: CellRef, dRow: number, dCol: number): CellRef {
	const span = model.getMergeAt(from.row, from.col) ?? {
		top: from.row,
		bottom: from.row,
		left: from.col,
		right: from.col,
	};
	let { row, col } = from;
	if (dRow > 0) row = span.bottom + 1;
	if (dRow < 0) row = span.top - 1;
	if (dCol > 0) col = span.right + 1;
	if (dCol < 0) col = span.left - 1;
	row = clamp(row, 0, model.visibleRowCount - 1);
	col = clamp(col, 0, model.colCount - 1);
	return snapToAnchor(model, { row, col });
}

/**
 * Interactive table with a single mode: the selected cell is always open
 * for editing, and arrow keys at the edge of its text move to the next
 * cell. Dragging, Shift+click and Ctrl/Cmd+click select several cells, keyboard navigation, and context-menu actions.
 * Every change produces a new model passed to `onChange`.
 */
export class TableEditor {
	readonly root: HTMLElement;
	private model: TableModel;
	private selection: Selection | null = null;
	private editing: { cell: CellRef; input: HTMLTextAreaElement } | null = null;
	private dragging = false;
	/** The cell a plain click went down on; releasing it there opens the cell. */
	private clickedCell: { cell: CellRef; committed: Promise<void> } | null = null;
	/** An edit to reopen once the table is first rendered (see EditorState.editing). */
	private restoreEdit: EditorState["editing"] | null;
	/** The next cell opened by `takeFocus` puts the caret at its start (moving right into it). */
	private caretAtStart = false;
	private resizing: { col: number; startX: number; start: number[]; widths: number[] } | null = null;
	private renderToken = 0;
	private hasFocus = false;
	private focusAfterRender: boolean;
	private scrollAfterRender: { top: number; left: number } | null;
	private readonly doc: Document;

	constructor(
		container: HTMLElement,
		model: TableModel,
		private readonly options: TableEditorOptions,
	) {
		this.model = model;
		this.doc = container.ownerDocument;
		this.root = this.doc.createElement("div");
		this.root.className = "dream-table-editor";
		this.root.tabIndex = 0;
		container.appendChild(this.root);

		this.focusAfterRender = options.initialState?.focused === true;
		this.scrollAfterRender = options.initialState?.scroll ?? null;
		this.restoreEdit = options.initialState?.editing ?? null;
		const initial = options.initialState?.selection;
		if (initial && this.inBounds(initial.anchor) && this.inBounds(initial.focus)) {
			this.selection = this.clampSelection(copySelection(initial));
		}

		this.root.addEventListener("mousedown", this.onMouseDown);
		this.root.addEventListener("mouseover", this.onMouseOver);
		this.root.addEventListener("mousemove", this.onHover);
		this.root.addEventListener("mouseleave", () => this.root.classList.remove("is-resize-hover"));
		this.root.addEventListener("click", this.onClick);
		this.root.addEventListener("dblclick", this.onDoubleClick);
		this.root.addEventListener("contextmenu", this.onContextMenu);
		this.root.addEventListener("keydown", this.onKeyDown);
		this.root.addEventListener("focusin", this.onFocusIn);
		this.root.addEventListener("focusout", this.onFocusOut);
		this.root.addEventListener("paste", this.onPaste);
		this.root.addEventListener("dragover", this.onDragOver);
		this.root.addEventListener("drop", this.onDrop);
		this.doc.addEventListener("mouseup", this.onMouseUp);
		// Capture phase, so a click is seen even if the note editor stops it.
		this.doc.addEventListener("mousedown", this.onDocumentMouseDown, true);
		this.doc.addEventListener("mousemove", this.onDocumentMouseMove);
		// Removing a focused element (on re-render) may not fire focusout, so
		// also notice focus landing anywhere else in the document.
		this.doc.addEventListener("focusin", this.onDocumentFocusIn);
	}

	destroy(): void {
		// Removing the textarea may blur it; that must not save from a dead table.
		this.editing = null;
		if (this.hasFocus) {
			this.hasFocus = false;
			this.options.onFocusChange?.(false);
		}
		this.renderToken++;
		this.doc.removeEventListener("mouseup", this.onMouseUp);
		this.doc.removeEventListener("mousedown", this.onDocumentMouseDown, true);
		this.doc.removeEventListener("mousemove", this.onDocumentMouseMove);
		this.doc.removeEventListener("focusin", this.onDocumentFocusIn);
		this.root.remove();
	}

	get currentModel(): TableModel {
		return this.model;
	}

	get state(): EditorState {
		const selection = this.selection && copySelection(this.selection);
		const state: EditorState = { selection, focused: this.root.contains(this.doc.activeElement) };
		const scroll = this.scrollPosition();
		if (scroll) state.scroll = scroll;
		if (this.editing) {
			const { cell, input } = this.editing;
			state.editing = { cell, text: input.value, start: input.selectionStart, end: input.selectionEnd };
		}
		return state;
	}

	/** Closes the open edit without saving or re-rendering (it moved to a re-created table). */
	dropEdit(): void {
		this.editing = null;
	}

	private get wrapper(): HTMLElement | null {
		return this.root.querySelector<HTMLElement>(".dream-table-wrapper");
	}

	private scrollPosition(): { top: number; left: number } | null {
		const wrapper = this.wrapper;
		if (!wrapper || (wrapper.scrollTop === 0 && wrapper.scrollLeft === 0)) return null;
		return { top: wrapper.scrollTop, left: wrapper.scrollLeft };
	}

	get isEditing(): boolean {
		return this.editing !== null;
	}

	/** Selected range, grown so it never cuts through a merge. */
	getSelectedRange(): Range | null {
		if (!this.selection) return null;
		return this.model.expandToMerges(normalizeRange(this.selection.anchor, this.selection.focus));
	}

	/**
	 * Every selected range, grown to whole merges: the active one first, then
	 * those added with Ctrl/Cmd+click, oldest first.
	 */
	getSelectedRanges(): Range[] {
		const active = this.getSelectedRange();
		if (!active) return [];
		const extra = (this.selection?.extra ?? []).map((range) => this.model.expandToMerges(range));
		return [active, ...extra];
	}

	/** Re-renders the table; `reopen` opens the selected cell for editing afterwards. */
	async render(reopen = false): Promise<void> {
		const token = ++this.renderToken;
		this.editing = null;
		const scroll = this.scrollPosition() ?? this.scrollAfterRender;
		this.scrollAfterRender = null;
		this.root.replaceChildren();
		await renderTable(this.model, this.root, this.options.renderMarkdown, () => void this.toggleCollapsed());
		if (token !== this.renderToken) return;
		const wrapper = this.wrapper;
		if (scroll && wrapper) {
			wrapper.scrollTop = scroll.top;
			wrapper.scrollLeft = scroll.left;
		}
		this.paintSelection();
		const restore = this.restoreEdit;
		this.restoreEdit = null;
		if (restore && this.inBounds(restore.cell)) {
			this.focusAfterRender = false;
			this.startEdit(restore.cell, restore.text, [restore.start, restore.end]);
		} else if (reopen) {
			this.focusAfterRender = false;
			this.takeFocus();
		} else if (this.focusAfterRender) {
			this.focusAfterRender = false;
			this.focusRoot();
		}
	}

	/** Hides or shows the rows below the header, and saves that. */
	async toggleCollapsed(): Promise<boolean> {
		if (this.model.headerRows === 0) return false;
		if (this.editing) await this.commitEdit();
		return this.applyChange((model) => {
			model.collapsed = !model.collapsed;
		});
	}

	/** Selects one cell, or with `extend` moves the active range's focus (keeping added ranges). */
	select(cell: CellRef, extend = false): void {
		const target = snapToAnchor(this.model, cell);
		this.selection =
			extend && this.selection
				? { ...this.selection, anchor: this.selection.anchor, focus: target }
				: { anchor: target, focus: target };
		this.paintSelection();
	}

	/**
	 * Ctrl/Cmd+click: starts a new active range at `cell` and keeps the
	 * current ones. Clicking a cell that is selected on its own deselects it.
	 * Returns whether the cell ends up selected.
	 */
	toggleCell(cell: CellRef): boolean {
		const target = snapToAnchor(this.model, cell);
		const ranges = this.getSelectedRanges();
		if (ranges.length === 0) {
			this.select(target);
			return true;
		}
		const own = this.cellRange(target);
		const index = ranges.findIndex((range) => rangesEqual(range, own));
		if (index > 0) {
			const selection = this.selection!;
			const extra = selection.extra!.filter((_, i) => i !== index - 1);
			this.selection = { anchor: selection.anchor, focus: selection.focus };
			if (extra.length > 0) this.selection.extra = extra;
		} else if (index === 0) {
			// The most recently added range becomes the active one.
			const extra = ranges.slice(1);
			this.selection = extra.length > 0 ? this.selectionOf([extra[extra.length - 1]!, ...extra.slice(0, -1)]) : null;
		} else {
			this.selection = { anchor: target, focus: target, extra: [...ranges.slice(1), ranges[0]!] };
		}
		this.paintSelection();
		return index < 0;
	}

	selectAll(): void {
		if (this.model.visibleRowCount === 0 || this.model.colCount === 0) return;
		this.select({ row: 0, col: 0 });
		this.select({ row: this.model.visibleRowCount - 1, col: this.model.colCount - 1 }, true);
	}

	clearSelection(): void {
		this.selection = null;
		this.paintSelection();
	}

	/**
	 * Takes keyboard focus from the host's cursor arriving at the table:
	 * selects the first cell when coming from before it, the last cell when
	 * coming from after. Returns false if the table has no cells.
	 */
	enter(side: "before" | "after"): boolean {
		if (this.model.visibleRowCount === 0 || this.model.colCount === 0) return false;
		this.select(
			side === "before"
				? { row: 0, col: 0 }
				: { row: this.model.visibleRowCount - 1, col: this.model.colCount - 1 },
		);
		this.caretAtStart = side === "before";
		this.takeFocus();
		return true;
	}

	move(dRow: number, dCol: number, extend = false): void {
		if (this.model.visibleRowCount === 0 || this.model.colCount === 0) return;
		if (!this.selection) {
			this.select({ row: 0, col: 0 });
			return;
		}
		this.select(stepFrom(this.model, this.selection.focus, dRow, dCol), extend);
	}

	/**
	 * Leaves the table if moving the focus cell by one step in that direction
	 * would go past its edge (see `onExit`). Returns whether it left.
	 */
	private exitAt(dRow: number, dCol: number): boolean {
		const side = this.edgeSide(dRow, dCol);
		if (!side || !this.options.onExit?.(side)) return false;
		this.clearSelection();
		return true;
	}

	/** Which way one step from the focus cell leaves the table, if it does. */
	private edgeSide(dRow: number, dCol: number): "before" | "after" | null {
		const focus = this.selection?.focus;
		if (!focus) return null;
		const span = this.model.getMergeAt(focus.row, focus.col) ?? {
			top: focus.row,
			bottom: focus.row,
			left: focus.col,
			right: focus.col,
		};
		const lastRow = this.model.visibleRowCount - 1;
		const lastCol = this.model.colCount - 1;
		let side: "before" | "after" | null = null;
		if (dRow < 0 && span.top === 0) side = "before";
		else if (dRow > 0 && span.bottom >= lastRow) side = "after";
		else if (dCol < 0 && rangeContainsCell(span, 0, 0)) side = "before";
		else if (dCol > 0 && rangeContainsCell(span, lastRow, lastCol)) side = "after";
		return side;
	}

	/**
	 * Replaces the cell's rendered content with a textarea holding its
	 * markdown, the caret at the end unless `caret` says otherwise.
	 */
	startEdit(cell?: CellRef, initialText?: string, caret?: [number, number]): void {
		const start = cell ?? this.selection?.focus;
		if (!start || !this.inBounds(start)) return;
		if (this.editing) this.cancelEdit();

		const target = snapToAnchor(this.model, start);
		this.select(target);
		const td = this.cellElement(target);
		if (!td) return;

		const input = this.doc.createElement("textarea");
		input.className = "dream-table-input";
		input.value = initialText ?? this.model.getCell(target.row, target.col);
		input.rows = Math.max(1, input.value.split("\n").length);
		input.addEventListener("keydown", this.onInputKeyDown);
		input.addEventListener("input", () => {
			input.rows = Math.max(1, input.value.split("\n").length);
		});
		// Focus went elsewhere (another app, the note), so do not take it back.
		input.addEventListener("blur", () => void this.commitEdit(0, 0, true, false));

		td.replaceChildren(input);
		td.classList.add("is-editing");
		this.editing = { cell: target, input };
		input.focus();
		const end = input.value.length;
		input.setSelectionRange(...(caret ?? [end, end]));
	}

	/**
	 * Saves the open edit and selects the cell one step away (or the same
	 * one), opening it for editing unless `reopen` is false. With `stay`
	 * false (the user clicked elsewhere) the table lets go of the selection
	 * and focus instead.
	 */
	async commitEdit(dRow = 0, dCol = 0, stay = true, reopen = stay): Promise<void> {
		const editing = this.editing;
		if (!editing) return;
		this.editing = null;
		const { cell, input } = editing;
		const value = input.value;
		if (!stay) this.selection = null;

		if (value === this.model.getCell(cell.row, cell.col)) {
			if (stay) this.select(stepFrom(this.model, cell, dRow, dCol));
			await this.render(stay && reopen);
			return;
		}
		await this.applyChange(
			(model) => {
				model.setCell(cell.row, cell.col, value);
				if (!stay) return;
				const next = stepFrom(model, cell, dRow, dCol);
				return { top: next.row, left: next.col, bottom: next.row, right: next.col };
			},
			stay,
			stay && reopen,
		);
	}

	/**
	 * Saves the open cell, inserts a row below it (below its merge, if it
	 * sits in one), and opens the cell under it. While the table is
	 * collapsed the new row would be hidden, so it just moves down instead.
	 * This is what Ctrl/Cmd+Enter does while a cell is being edited.
	 */
	async commitAndInsertRow(): Promise<void> {
		const editing = this.editing;
		if (!editing) return;
		if (this.model.collapsed) return this.commitEdit(1, 0);
		this.editing = null;
		const { cell, input } = editing;
		const value = input.value;
		await this.applyChange(
			(model) => {
				model.setCell(cell.row, cell.col, value);
				const row = (model.getMergeAt(cell.row, cell.col)?.bottom ?? cell.row) + 1;
				model.insertRows(row);
				return { top: row, bottom: row, left: cell.col, right: cell.col };
			},
			true,
			true,
		);
	}

	/** Moves from the open cell by one step, leaving the table past its edge (see `onExit`). */
	private async leaveCell(dRow: number, dCol: number): Promise<void> {
		const cell = this.editing?.cell;
		if (!cell) return;
		const side = this.edgeSide(dRow, dCol);
		if (!side) {
			this.caretAtStart = dCol > 0;
			await this.commitEdit(dRow, dCol);
			return;
		}
		if (!this.options.onExit) return;
		await this.commitEdit(0, 0, false);
		if (this.options.onExit(side)) return;
		this.select(cell);
		this.takeFocus();
	}

	/** Puts the open cell's text back to what is saved. */
	private revertEdit(): void {
		const editing = this.editing;
		if (!editing) return;
		const saved = this.model.getCell(editing.cell.row, editing.cell.col);
		applyToTextarea(editing.input, {
			from: 0,
			to: editing.input.value.length,
			insert: saved,
			selectionStart: saved.length,
			selectionEnd: saved.length,
		});
	}

	cancelEdit(): void {
		if (!this.editing) return;
		this.editing = null;
		void this.render();
		this.focusRoot();
	}

	/**
	 * Runs a mutation on a copy of the model. The returned range (if any)
	 * becomes the new selection; an array of ranges selects all of them, the
	 * first being the active one. Rolls back if the mutation throws or
	 * `onChange` reports that saving failed. `keepFocus` false lets the
	 * re-rendered table leave focus where the user put it; `reopen` opens
	 * the selected cell for editing once it is re-rendered.
	 */
	async applyChange(
		mutate: (model: TableModel) => Range | Range[] | void,
		keepFocus = true,
		reopen = false,
	): Promise<boolean> {
		const previous = this.model;
		const previousSelection = this.selection;
		const next = previous.clone();
		let range: Range | Range[] | void;
		try {
			range = mutate(next);
		} catch (error) {
			this.options.onError?.(error);
			return false;
		}

		this.model = next;
		if (Array.isArray(range)) {
			if (range.length > 0) this.selection = this.selectionOf(range);
		} else if (range) {
			this.selection = this.selectionOf([range]);
		}
		this.selection = this.clampSelection(this.selection);

		// Changes come from interacting with this table, so it should usually keep focus.
		const state: EditorState = { ...this.state, focused: keepFocus };
		// Saving may re-create the table before this one has reopened the
		// cell, so tell the new table which cell to open.
		const focus = this.selection?.focus;
		if (reopen && focus && this.isSingleSelection()) {
			const text = next.getCell(focus.row, focus.col);
			const caret = this.caretAtStart ? 0 : text.length;
			state.editing = { cell: { ...focus }, text, start: caret, end: caret };
		}
		const saved = this.options.onChange(next, state);
		await this.render(reopen);
		if (await saved) return true;

		this.model = previous;
		this.selection = previousSelection;
		await this.render();
		return false;
	}

	/** Runs one of TABLE_ACTIONS on the current selection (all of its ranges). */
	runAction(id: string): Promise<boolean> {
		const action = TABLE_ACTIONS.find((a) => a.id === id);
		const ranges = this.getSelectedRanges();
		if (!action || !isActionEnabled(action, this.model, ranges)) return Promise.resolve(false);
		return this.applyChange((model) => runTableAction(action, model, ranges));
	}

	// ------------------------------------------------------------- events

	private readonly onMouseDown = (evt: MouseEvent) => {
		if (this.editingTarget(evt)) {
			evt.stopPropagation();
			return;
		}
		if (evt.button !== 0) {
			// Keep right/middle clicks on cells from reaching the note editor,
			// which would take focus (and later scroll back to its cursor).
			if (this.cellFromEvent(evt)) evt.stopPropagation();
			return;
		}
		const edge = this.columnEdgeAt(evt);
		if (edge !== null) {
			evt.preventDefault();
			evt.stopPropagation();
			if (this.editing) void this.commitEdit();
			this.startResize(edge, evt.clientX);
			return;
		}
		const cell = this.cellFromEvent(evt);
		if (!cell) return;
		// Keep the browser from starting a text selection or moving the editor cursor.
		evt.preventDefault();
		evt.stopPropagation();
		const committed = this.editing ? this.commitEdit() : Promise.resolve();
		this.clickedCell = null;
		// Dragging after Ctrl/Cmd+click grows the new range, unless the click deselected the cell.
		if ((evt.ctrlKey || evt.metaKey) && !evt.shiftKey) this.dragging = this.toggleCell(cell);
		else {
			this.select(cell, evt.shiftKey);
			this.dragging = true;
			// Links and checkboxes inside the cell keep working instead.
			const target = evt.target as Element;
			if (!evt.shiftKey && !target.closest("a, input")) this.clickedCell = { cell, committed };
		}
		this.focusRoot();
	};

	/** A click anywhere else ends the selection (and saves an open edit). */
	private readonly onDocumentMouseDown = (evt: MouseEvent) => {
		const target = evt.target as Element | null;
		if (!target || this.root.contains(target)) return;
		if (this.options.keepsSelection?.(target)) return;
		if (this.editing) void this.commitEdit(0, 0, false);
		else if (this.selection) this.clearSelection();
	};

	private readonly onMouseOver = (evt: MouseEvent) => {
		if (!this.dragging) return;
		const cell = this.cellFromEvent(evt);
		if (!cell) return;
		const clicked = this.clickedCell?.cell;
		if (clicked && !sameAnchor(this.model, clicked, cell)) this.clickedCell = null;
		this.select(cell, true);
	};

	private readonly onMouseUp = () => {
		this.dragging = false;
		if (this.resizing) this.finishResize();
		const clicked = this.clickedCell;
		this.clickedCell = null;
		if (!clicked) return;
		// Wait for the previous cell's edit to be saved and the table re-rendered.
		void clicked.committed.then(() => {
			const focus = this.selection?.focus;
			if (this.editing || !this.root.isConnected || !focus || !sameAnchor(this.model, focus, clicked.cell)) return;
			if (this.getSelectedRanges().length > 1) return;
			this.startEdit(clicked.cell);
		});
	};

	/** Shows the resize cursor near column borders. */
	private readonly onHover = (evt: MouseEvent) => {
		if (this.resizing || this.dragging) return;
		this.root.classList.toggle("is-resize-hover", this.columnEdgeAt(evt) !== null);
	};

	private readonly onDocumentMouseMove = (evt: MouseEvent) => {
		const resizing = this.resizing;
		const table = this.tableElement();
		if (!resizing || !table) return;
		evt.preventDefault();
		resizing.widths = resizedWidths(resizing.start, resizing.col, evt.clientX - resizing.startX);
		applyColumnWidths(table, resizing.widths);
	};

	// ------------------------------------------------------------- resizing

	private startResize(col: number, clientX: number): void {
		const table = this.tableElement();
		if (!table) return;
		const start = startingWidths(this.model.columnWidths, () =>
			measureColumnWidths(table, this.model.colCount),
		);
		this.resizing = { col, startX: clientX, start, widths: start };
		this.root.classList.add("is-resizing");
	}

	/** Saves the dragged widths as one change. */
	private finishResize(): void {
		const { start, widths } = this.resizing!;
		this.resizing = null;
		this.root.classList.remove("is-resizing");
		if (widths.every((w, i) => w === start[i])) return;
		void this.applyChange((model) => {
			widths.forEach((width, col) => model.setColumnWidth(col, width));
		});
	}

	/** Column whose right border is under the pointer, if any. */
	private columnEdgeAt(evt: MouseEvent): number | null {
		const target = evt.target as Element | null;
		const td = target?.closest?.("td[data-col]") as HTMLTableCellElement | null;
		if (!td || !this.root.contains(td)) return null;
		return hitColumnEdge(td.getBoundingClientRect(), evt.clientX, Number(td.dataset.col), td.colSpan);
	}

	private tableElement(): HTMLTableElement | null {
		return this.root.querySelector<HTMLTableElement>("table.dream-table");
	}

	/** Ticking a rendered task checkbox saves the change to the cell's markdown. */
	private readonly onClick = (evt: MouseEvent) => {
		const target = evt.target as HTMLInputElement | null;
		if (target?.tagName !== "INPUT" || target.type !== "checkbox") return;
		const cell = this.cellFromEvent(evt);
		const td = target.closest("td[data-row]");
		if (!cell || !td || this.editing) return;
		// The browser has already flipped `checked`; the re-render shows it from
		// the saved markdown instead. Keep the note's editor from acting on it too.
		evt.preventDefault();
		evt.stopPropagation();
		const index = Array.from(td.querySelectorAll("input[type=checkbox]")).indexOf(target);
		const content = this.model.getCell(cell.row, cell.col);
		const next = setTaskChecked(content, index, target.checked);
		if (next === content) return;
		void this.applyChange((model) => {
			model.setCell(cell.row, cell.col, next);
		});
	};

	private readonly onDoubleClick = (evt: MouseEvent) => {
		const cell = this.cellFromEvent(evt);
		if (!cell || this.editingTarget(evt) || this.columnEdgeAt(evt) !== null) return;
		evt.preventDefault();
		this.startEdit(cell);
	};

	private readonly onContextMenu = async (evt: MouseEvent) => {
		const cell = this.cellFromEvent(evt);
		if (!cell || !this.options.onContextMenu) return;
		evt.preventDefault();
		evt.stopPropagation();
		// The table's menu replaces the textarea's; save the cell first.
		if (this.editing) await this.commitEdit(0, 0, true, false);
		const ranges = this.getSelectedRanges();
		if (!ranges.some((range) => rangeContainsCell(range, cell.row, cell.col))) this.select(cell);
		this.options.onContextMenu(evt, this.getSelectedRanges());
	};

	private readonly onKeyDown = (evt: KeyboardEvent) => {
		if (this.editing || this.editingTarget(evt)) return;
		const handled = this.handleKey(evt);
		if (handled) {
			evt.preventDefault();
			evt.stopPropagation();
		}
	};

	private handleKey(evt: KeyboardEvent): boolean {
		const mod = evt.ctrlKey || evt.metaKey;
		switch (evt.key) {
			case "ArrowUp":
			case "ArrowDown":
			case "ArrowLeft":
			case "ArrowRight": {
				const [dRow, dCol] = ARROW_STEPS[evt.key]!;
				if (!evt.shiftKey && this.exitAt(dRow, dCol)) return true;
				this.move(dRow, dCol, evt.shiftKey);
				if (!evt.shiftKey) this.takeFocus();
				return true;
			}
			case "Tab":
				this.move(0, evt.shiftKey ? -1 : 1);
				this.takeFocus();
				return true;
			case "Enter":
			case "F2":
				if (!this.selection) return false;
				this.startEdit();
				return true;
			case "Escape":
				// Several cells selected: go back to editing just the active one.
				if (!this.selection) return false;
				this.select(this.selection.focus);
				this.takeFocus();
				return true;
			case "Delete":
			case "Backspace": {
				const ranges = this.getSelectedRanges();
				if (ranges.length === 0) return false;
				void this.applyChange((model) => {
					for (const range of ranges) clearContent(model, range);
					return ranges;
				});
				return true;
			}
		}
		const shortcut = shortcutKey(evt);
		if (shortcut) {
			// The host may already have routed this key here (see onFocusChange).
			if (!evt.defaultPrevented) this.handleShortcut(shortcut);
			return true;
		}
		// Typing a character starts editing and replaces the content, like a spreadsheet.
		if (evt.key.length === 1 && !mod && !evt.altKey && this.selection) {
			this.startEdit(undefined, evt.key);
			return true;
		}
		return false;
	}

	private readonly onInputKeyDown = (evt: KeyboardEvent) => {
		evt.stopPropagation();
		const shortcut = shortcutKey(evt);
		if (shortcut) {
			if (!evt.defaultPrevented) this.handleShortcut(shortcut);
			evt.preventDefault();
			return;
		}
		const input = evt.currentTarget as HTMLTextAreaElement;
		const plain = !evt.shiftKey && !evt.altKey && !evt.ctrlKey && !evt.metaKey;
		const step = ARROW_STEPS[evt.key];
		// Arrows move the caret, and on to the next cell once it is at the text's edge.
		if (step && plain && caretAtEdge(input, evt.key)) {
			evt.preventDefault();
			void this.leaveCell(...step);
			return;
		}
		// Plain Enter types a newline; Ctrl/Cmd+Enter saves and starts a new row below.
		if (evt.key === "Enter" && (evt.ctrlKey || evt.metaKey)) {
			// The host may already have routed this key here (see onFocusChange).
			if (!evt.defaultPrevented) void this.commitAndInsertRow();
			evt.preventDefault();
		} else if (evt.key === "Tab") {
			evt.preventDefault();
			const state = { text: input.value, start: input.selectionStart, end: input.selectionEnd };
			// Tab indents list items (and multi-line selections); elsewhere it moves to the next cell.
			if (!indentsHere(state)) {
				void this.commitEdit(0, evt.shiftKey ? -1 : 1);
				return;
			}
			const edit = indentLines(state, evt.shiftKey);
			if (edit.insert !== state.text.slice(edit.from, edit.to)) applyToTextarea(input, edit);
		} else if (evt.key === "Escape") {
			evt.preventDefault();
			this.revertEdit();
		}
	};

	/**
	 * Runs Ctrl/Cmd + B, I, K or A. While a cell is being edited they format
	 * its text (A selects all of it); otherwise B and I style the selected
	 * cells and A selects every cell. Returns false if there was nothing to do.
	 */
	handleShortcut(key: ShortcutKey): boolean {
		const editing = this.editing;
		if (editing) {
			const { input } = editing;
			if (key === "a") {
				input.select();
				return true;
			}
			const state = { text: input.value, start: input.selectionStart, end: input.selectionEnd };
			applyToTextarea(input, INPUT_SHORTCUTS[key](state));
			return true;
		}
		if (key === "a") {
			this.selectAll();
			return true;
		}
		if ((key === "b" || key === "i") && this.selection) {
			void this.runAction(key === "b" ? "bold" : "italic");
			return true;
		}
		return false;
	}

	// --------------------------------------------------------------- images

	/** Image pastes: at the cursor while editing, else appended to the focused cell. */
	private readonly onPaste = (evt: ClipboardEvent) => {
		const files = imageFilesFrom(evt.clipboardData);
		if (files.length === 0 || !this.options.onInsertFiles) return;
		const target = this.editing?.cell ?? this.selection?.focus;
		if (!target) return;
		evt.preventDefault();
		evt.stopPropagation();
		void this.insertImages(files, target);
	};

	/** Allows dropping files on cells (the browser would otherwise open them). */
	private readonly onDragOver = (evt: DragEvent) => {
		if (!this.options.onInsertFiles || !evt.dataTransfer?.types.includes("Files")) return;
		if (!this.cellFromEvent(evt)) return;
		evt.preventDefault();
		evt.stopPropagation();
		evt.dataTransfer.dropEffect = "copy";
	};

	/** Image drops: at the cursor in the cell being edited, else appended to the cell under the pointer. */
	private readonly onDrop = (evt: DragEvent) => {
		const files = imageFilesFrom(evt.dataTransfer);
		const cell = this.cellFromEvent(evt);
		if (files.length === 0 || !cell || !this.options.onInsertFiles) return;
		evt.preventDefault();
		evt.stopPropagation();
		void this.insertImages(files, snapToAnchor(this.model, cell));
	};

	/**
	 * Saves the images through the host and puts their markdown into `cell`:
	 * at the cursor if that cell is being edited, otherwise on a new line at
	 * the end of its content.
	 */
	async insertImages(files: File[], cell: CellRef): Promise<boolean> {
		let snippets: string[];
		try {
			snippets = (await this.options.onInsertFiles?.(files)) ?? [];
		} catch (error) {
			this.options.onError?.(error);
			return false;
		}
		if (snippets.length === 0) return false;
		const text = snippets.join("\n");

		const editing = this.editing;
		if (editing && editing.cell.row === cell.row && editing.cell.col === cell.col) {
			const { input } = editing;
			const start = input.selectionStart;
			const end = start + text.length;
			applyToTextarea(input, { from: start, to: input.selectionEnd, insert: text, selectionStart: end, selectionEnd: end });
			return true;
		}
		if (editing) await this.commitEdit();
		if (!this.inBounds(cell)) return false;
		const target = snapToAnchor(this.model, cell);
		return this.applyChange((model) => {
			model.setCell(target.row, target.col, appendToCell(model.getCell(target.row, target.col), text));
			return { top: target.row, left: target.col, bottom: target.row, right: target.col };
		});
	}

	/** Appends markdown (e.g. an image embed) to the selected cell. */
	appendToSelectedCell(markdown: string): Promise<boolean> {
		const focus = this.selection?.focus;
		if (!focus) return Promise.resolve(false);
		const target = snapToAnchor(this.model, focus);
		return this.applyChange((model) => {
			model.setCell(target.row, target.col, appendToCell(model.getCell(target.row, target.col), markdown));
			return { top: target.row, left: target.col, bottom: target.row, right: target.col };
		});
	}

	private readonly onFocusIn = () => {
		if (this.hasFocus) return;
		this.hasFocus = true;
		this.options.onFocusChange?.(true);
	};

	private readonly onDocumentFocusIn = (evt: FocusEvent) => {
		const target = evt.target as Node | null;
		if (!this.hasFocus || (target && this.root.contains(target))) return;
		this.hasFocus = false;
		this.options.onFocusChange?.(false);
	};

	/** Whether keyboard focus is currently inside the table or its cell editor. */
	get containsFocus(): boolean {
		return this.root.contains(this.doc.activeElement);
	}

	private readonly onFocusOut = (evt: FocusEvent) => {
		// Moving between the table and its cell editor keeps focus inside.
		const next = evt.relatedTarget as Node | null;
		if (next && this.root.contains(next)) return;
		if (!this.hasFocus) return;
		this.hasFocus = false;
		this.options.onFocusChange?.(false);
	};

	// ------------------------------------------------------------ helpers

	private paintSelection(): void {
		const ranges = this.getSelectedRanges();
		const focus = this.selection?.focus;
		this.root.classList.toggle("has-single-selection", this.isSingleSelection());
		for (const td of Array.from(this.root.querySelectorAll<HTMLTableCellElement>("td[data-row]"))) {
			const row = Number(td.dataset.row);
			const col = Number(td.dataset.col);
			td.classList.toggle("is-selected", ranges.some((range) => rangeContainsCell(range, row, col)));
			td.classList.toggle("is-focus", focus !== undefined && focus.row === row && focus.col === col);
		}
	}

	/** The cell, or the whole merge it is part of, as a range. */
	private cellRange(cell: CellRef): Range {
		return this.model.expandToMerges({ top: cell.row, left: cell.col, bottom: cell.row, right: cell.col });
	}

	private cellElement(cell: CellRef): HTMLTableCellElement | null {
		return this.root.querySelector<HTMLTableCellElement>(
			`td[data-row="${cell.row}"][data-col="${cell.col}"]`,
		);
	}

	private cellFromEvent(evt: Event): CellRef | null {
		const target = evt.target as Element | null;
		const td = target?.closest?.("td[data-row]") as HTMLTableCellElement | null;
		if (!td || !this.root.contains(td)) return null;
		return { row: Number(td.dataset.row), col: Number(td.dataset.col) };
	}

	private editingTarget(evt: Event): boolean {
		return this.editing !== null && evt.target === this.editing.input;
	}

	private focusRoot(): void {
		if (this.root.isConnected) this.root.focus({ preventScroll: true });
	}

	/** Focuses the table: a single selected cell opens for editing; several cells stay selected. */
	private takeFocus(): void {
		const atStart = this.caretAtStart;
		this.caretAtStart = false;
		if (!this.root.isConnected) return;
		if (this.isSingleSelection()) this.startEdit(undefined, undefined, atStart ? [0, 0] : undefined);
		else this.focusRoot();
	}

	private isSingleSelection(): boolean {
		const ranges = this.getSelectedRanges();
		const focus = this.selection?.focus;
		return ranges.length === 1 && focus !== undefined && rangesEqual(ranges[0]!, this.cellRange(focus));
	}

	private inBounds(cell: CellRef): boolean {
		return cell.row >= 0 && cell.col >= 0 && cell.row < this.model.rowCount && cell.col < this.model.colCount;
	}

	private clampSelection(selection: Selection | null): Selection | null {
		if (!selection || this.model.visibleRowCount === 0 || this.model.colCount === 0) return null;
		const fix = (cell: CellRef) =>
			snapToAnchor(this.model, {
				row: clamp(cell.row, 0, this.model.visibleRowCount - 1),
				col: clamp(cell.col, 0, this.model.colCount - 1),
			});
		const lastRow = this.model.visibleRowCount - 1;
		const lastCol = this.model.colCount - 1;
		const extra = (selection.extra ?? [])
			.filter((range) => range.top <= lastRow && range.left <= lastCol)
			.map((range) => ({
				top: range.top,
				left: range.left,
				bottom: Math.min(range.bottom, lastRow),
				right: Math.min(range.right, lastCol),
			}));
		const fixed: Selection = { anchor: fix(selection.anchor), focus: fix(selection.focus) };
		if (extra.length > 0) fixed.extra = extra;
		return fixed;
	}

	/** A selection of `ranges`, the first one active (anchor at its top-left). */
	private selectionOf(ranges: Range[]): Selection {
		const [first, ...extra] = ranges;
		const selection: Selection = {
			anchor: snapToAnchor(this.model, { row: first!.top, col: first!.left }),
			focus: snapToAnchor(this.model, { row: first!.bottom, col: first!.right }),
		};
		if (extra.length > 0) selection.extra = extra.map((range) => ({ ...range }));
		return selection;
	}
}

function copySelection(selection: Selection): Selection {
	const copy: Selection = { anchor: { ...selection.anchor }, focus: { ...selection.focus } };
	if (selection.extra?.length) copy.extra = selection.extra.map((range) => ({ ...range }));
	return copy;
}

export const SHORTCUT_KEYS = ["b", "i", "k", "a"] as const;
export type ShortcutKey = (typeof SHORTCUT_KEYS)[number];

/** The shortcut a key event is (Ctrl/Cmd + letter, no Alt/Shift), if any. */
function shortcutKey(evt: KeyboardEvent): ShortcutKey | null {
	if (!(evt.ctrlKey || evt.metaKey) || evt.altKey || evt.shiftKey) return null;
	const key = evt.key.toLowerCase();
	return (SHORTCUT_KEYS as readonly string[]).includes(key) ? (key as ShortcutKey) : null;
}

/** Markdown formatting shortcuts inside the cell editor, matching Obsidian's defaults. */
const INPUT_SHORTCUTS: Record<Exclude<ShortcutKey, "a">, (state: TextState) => TextEdit> = {
	b: (state) => toggleMarker(state, "**"),
	i: (state) => toggleMarker(state, "*"),
	k: insertLink,
};

const ARROW_STEPS: Record<string, [number, number]> = {
	ArrowUp: [-1, 0],
	ArrowDown: [1, 0],
	ArrowLeft: [0, -1],
	ArrowRight: [0, 1],
};

/** Whether an arrow key would move the caret out of the text (no text selected). */
function caretAtEdge(input: HTMLTextAreaElement, key: string): boolean {
	const { value, selectionStart: start, selectionEnd: end } = input;
	if (start !== end) return false;
	switch (key) {
		case "ArrowUp":
			return !value.slice(0, start).includes("\n");
		case "ArrowDown":
			return !value.slice(start).includes("\n");
		case "ArrowLeft":
			return start === 0;
		case "ArrowRight":
			return start === value.length;
	}
	return false;
}

/** Whether Tab should indent: the caret is on a list item, or the selection spans lines. */
function indentsHere(state: TextState): boolean {
	const { text, start, end } = state;
	if (text.slice(start, end).includes("\n")) return true;
	const from = text.lastIndexOf("\n", start - 1) + 1;
	const lineEnd = text.indexOf("\n", start);
	const line = text.slice(from, lineEnd === -1 ? text.length : lineEnd);
	return /^\s*([-*+]|\d+[.)])(\s|$)/.test(line);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
