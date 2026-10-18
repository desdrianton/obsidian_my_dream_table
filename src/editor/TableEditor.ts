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
 * Interactive table: click/drag/shift-click to select, double-click, Enter,
 * or typing to edit a cell, keyboard navigation, and context-menu actions.
 * Every change produces a new model passed to `onChange`.
 */
export class TableEditor {
	readonly root: HTMLElement;
	private model: TableModel;
	private selection: Selection | null = null;
	private editing: { cell: CellRef; input: HTMLTextAreaElement } | null = null;
	private dragging = false;
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
		return state;
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

	async render(): Promise<void> {
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
		if (this.focusAfterRender) {
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
		const own = this.model.expandToMerges({ top: target.row, left: target.col, bottom: target.row, right: target.col });
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
		this.focusRoot();
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
		const focus = this.selection?.focus;
		if (!focus || !this.options.onExit) return false;
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
		if (!side || !this.options.onExit(side)) return false;
		this.clearSelection();
		return true;
	}

	/** Replaces the cell's rendered content with a textarea holding its markdown. */
	startEdit(cell?: CellRef, initialText?: string): void {
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
		input.addEventListener("blur", () => void this.commitEdit());

		td.replaceChildren(input);
		td.classList.add("is-editing");
		this.editing = { cell: target, input };
		input.focus();
		const end = input.value.length;
		input.setSelectionRange(end, end);
	}

	/**
	 * Saves the open edit, then optionally moves the selection. With `stay`
	 * false (the user clicked elsewhere) the table lets go of the selection
	 * and focus instead.
	 */
	async commitEdit(dRow = 0, dCol = 0, stay = true): Promise<void> {
		const editing = this.editing;
		if (!editing) return;
		this.editing = null;
		const { cell, input } = editing;
		const value = input.value;
		if (!stay) this.selection = null;

		if (value === this.model.getCell(cell.row, cell.col)) {
			await this.render();
			if (!stay) return;
			this.focusRoot();
			if (dRow !== 0 || dCol !== 0) this.move(dRow, dCol);
			return;
		}
		await this.applyChange((model) => {
			model.setCell(cell.row, cell.col, value);
			if (!stay) return;
			const next = stepFrom(model, cell, dRow, dCol);
			return { top: next.row, left: next.col, bottom: next.row, right: next.col };
		}, stay);
		if (stay) this.focusRoot();
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
	 * re-rendered table leave focus where the user put it.
	 */
	async applyChange(mutate: (model: TableModel) => Range | Range[] | void, keepFocus = true): Promise<boolean> {
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
		const saved = this.options.onChange(next, { ...this.state, focused: keepFocus });
		await this.render();
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
		if (this.editing) void this.commitEdit();
		// Dragging after Ctrl/Cmd+click grows the new range, unless the click deselected the cell.
		if ((evt.ctrlKey || evt.metaKey) && !evt.shiftKey) this.dragging = this.toggleCell(cell);
		else {
			this.select(cell, evt.shiftKey);
			this.dragging = true;
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
		if (cell) this.select(cell, true);
	};

	private readonly onMouseUp = () => {
		this.dragging = false;
		if (this.resizing) this.finishResize();
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

	private readonly onContextMenu = (evt: MouseEvent) => {
		const cell = this.cellFromEvent(evt);
		if (!cell || this.editingTarget(evt) || !this.options.onContextMenu) return;
		evt.preventDefault();
		evt.stopPropagation();
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
				if (!evt.shiftKey && this.exitAt(-1, 0)) return true;
				this.move(-1, 0, evt.shiftKey);
				return true;
			case "ArrowDown":
				if (!evt.shiftKey && this.exitAt(1, 0)) return true;
				this.move(1, 0, evt.shiftKey);
				return true;
			case "ArrowLeft":
				if (!evt.shiftKey && this.exitAt(0, -1)) return true;
				this.move(0, -1, evt.shiftKey);
				return true;
			case "ArrowRight":
				if (!evt.shiftKey && this.exitAt(0, 1)) return true;
				this.move(0, 1, evt.shiftKey);
				return true;
			case "Tab":
				this.move(0, evt.shiftKey ? -1 : 1);
				return true;
			case "Enter":
			case "F2":
				if (!this.selection) return false;
				this.startEdit();
				return true;
			case "Escape":
				if (!this.selection) return false;
				this.clearSelection();
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
		if (evt.key === "Enter" && !evt.shiftKey) {
			evt.preventDefault();
			void this.commitEdit(1, 0);
		} else if (evt.key === "Tab") {
			evt.preventDefault();
			const input = evt.currentTarget as HTMLTextAreaElement;
			const state = { text: input.value, start: input.selectionStart, end: input.selectionEnd };
			const edit = indentLines(state, evt.shiftKey);
			if (edit.insert !== state.text.slice(edit.from, edit.to)) applyToTextarea(input, edit);
		} else if (evt.key === "Escape") {
			evt.preventDefault();
			this.cancelEdit();
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
		for (const td of Array.from(this.root.querySelectorAll<HTMLTableCellElement>("td[data-row]"))) {
			const row = Number(td.dataset.row);
			const col = Number(td.dataset.col);
			td.classList.toggle("is-selected", ranges.some((range) => rangeContainsCell(range, row, col)));
			td.classList.toggle("is-focus", focus !== undefined && focus.row === row && focus.col === col);
		}
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

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}
