// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatRange, parseRange } from "../../src/model/address";
import { TableModel } from "../../src/model/TableModel";
import {
	snapToAnchor,
	stepFrom,
	TableEditor,
	type EditorState,
	type TableEditorOptions,
} from "../../src/editor/TableEditor";
import type { RenderMarkdown } from "../../src/render/renderTable";

const r = parseRange;

const plainText: RenderMarkdown = async (markdown, el) => {
	el.textContent = markdown;
};

/** 3x3 grid whose cells hold their own address. */
function grid(rows = 3, cols = 3): TableModel {
	const m = TableModel.create(rows, cols);
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) m.setCell(row, col, formatRange({ top: row, left: col, bottom: row, right: col }));
	}
	return m;
}

let container: HTMLElement;
let editor: TableEditor;
let onChange: ReturnType<typeof vi.fn<(model: TableModel, state: EditorState) => Promise<boolean>>>;

async function mount(model: TableModel, options: Partial<TableEditorOptions> = {}): Promise<TableEditor> {
	onChange = vi.fn(async () => true);
	editor = new TableEditor(container, model, { renderMarkdown: plainText, onChange, ...options });
	await editor.render();
	return editor;
}

function td(address: string): HTMLTableCellElement {
	const { row, col } = { row: r(address).top, col: r(address).left };
	const el = container.querySelector<HTMLTableCellElement>(`td[data-row="${row}"][data-col="${col}"]`);
	if (!el) throw new Error(`No rendered cell at ${address}`);
	return el;
}

function selected(): string | null {
	const range = editor.getSelectedRange();
	return range && formatRange(range);
}

function mouse(target: Element, type: string, init: MouseEventInit = {}): MouseEvent {
	const evt = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init });
	target.dispatchEvent(evt);
	return evt;
}

function key(target: Element, keyName: string, init: KeyboardEventInit = {}): KeyboardEvent {
	const evt = new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true, ...init });
	target.dispatchEvent(evt);
	return evt;
}

function input(): HTMLTextAreaElement {
	const el = container.querySelector<HTMLTextAreaElement>("textarea.dream-table-input");
	if (!el) throw new Error("Not editing");
	return el;
}

/** Lets pending promise chains (render, onChange) settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	document.body.innerHTML = "";
	container = document.createElement("div");
	document.body.appendChild(container);
});

afterEach(() => editor?.destroy());

describe("pure helpers", () => {
	it("snapToAnchor maps covered cells to the merge's top-left", () => {
		const m = grid();
		m.merge(r("B2:C3"));
		expect(snapToAnchor(m, { row: 2, col: 2 })).toEqual({ row: 1, col: 1 });
		expect(snapToAnchor(m, { row: 0, col: 2 })).toEqual({ row: 0, col: 2 });
	});

	it("stepFrom jumps over merges and stops at edges", () => {
		const m = grid();
		m.merge(r("A1:B2"));
		expect(stepFrom(m, { row: 0, col: 0 }, 0, 1)).toEqual({ row: 0, col: 2 });
		expect(stepFrom(m, { row: 0, col: 0 }, 1, 0)).toEqual({ row: 2, col: 0 });
		expect(stepFrom(m, { row: 0, col: 2 }, 0, -1)).toEqual({ row: 0, col: 0 });
		expect(stepFrom(m, { row: 0, col: 0 }, -1, 0)).toEqual({ row: 0, col: 0 });
		expect(stepFrom(m, { row: 2, col: 2 }, 1, 1)).toEqual({ row: 2, col: 2 });
	});
});

describe("selection", () => {
	it("selects a cell on mousedown and marks it", async () => {
		await mount(grid());
		mouse(td("B2"), "mousedown");
		expect(selected()).toBe("B2");
		expect(td("B2").classList.contains("is-selected")).toBe(true);
		expect(td("B2").classList.contains("is-focus")).toBe(true);
		expect(td("A1").classList.contains("is-selected")).toBe(false);
		expect(document.activeElement).toBe(editor.root);
	});

	it("extends with shift-click", async () => {
		await mount(grid());
		mouse(td("A1"), "mousedown");
		mouse(td("B3"), "mousedown", { shiftKey: true });
		expect(selected()).toBe("A1:B3");
		expect(td("B2").classList.contains("is-selected")).toBe(true);
		expect(td("A1").classList.contains("is-focus")).toBe(false);
		expect(td("B3").classList.contains("is-focus")).toBe(true);
	});

	it("extends by dragging until mouseup", async () => {
		await mount(grid());
		mouse(td("A1"), "mousedown");
		mouse(td("B2"), "mouseover");
		mouse(document.body, "mouseup");
		mouse(td("C3"), "mouseover");
		expect(selected()).toBe("A1:B2");
	});

	it("expands the selection to cover merges", async () => {
		const m = grid();
		m.merge(r("B2:C3"));
		await mount(m);
		mouse(td("A1"), "mousedown");
		mouse(td("B2"), "mousedown", { shiftKey: true });
		expect(selected()).toBe("A1:C3");
	});

	it("ignores clicks outside cells and non-left buttons", async () => {
		await mount(grid());
		mouse(editor.root, "mousedown");
		mouse(td("A1"), "mousedown", { button: 2 });
		expect(selected()).toBeNull();
	});

	it("keeps right and middle clicks on cells from reaching the note", async () => {
		await mount(grid());
		const outside = vi.fn();
		document.body.addEventListener("mousedown", outside);
		mouse(td("A1"), "mousedown", { button: 2 });
		mouse(td("A1"), "mousedown", { button: 1 });
		mouse(td("A1"), "dblclick");
		mouse(input(), "mousedown");
		expect(outside).not.toHaveBeenCalled();
		document.body.removeEventListener("mousedown", outside);
	});

	it("restores the selection from an initial state", async () => {
		await mount(grid(), {
			initialState: { selection: { anchor: { row: 0, col: 0 }, focus: { row: 1, col: 1 } }, focused: true },
		});
		expect(selected()).toBe("A1:B2");
		expect(td("A1").classList.contains("is-selected")).toBe(true);
		expect(document.activeElement).toBe(editor.root);
	});

	it("drops an initial selection that no longer fits the table", async () => {
		await mount(grid(), {
			initialState: { selection: { anchor: { row: 5, col: 0 }, focus: { row: 5, col: 0 } } },
		});
		expect(selected()).toBeNull();
	});
});

describe("keyboard navigation", () => {
	it("moves with arrows and extends with shift", async () => {
		await mount(grid());
		mouse(td("A1"), "mousedown");
		key(editor.root, "ArrowRight");
		key(editor.root, "ArrowDown");
		expect(selected()).toBe("B2");
		key(editor.root, "ArrowRight", { shiftKey: true });
		expect(selected()).toBe("B2:C2");
		key(editor.root, "ArrowLeft");
		expect(selected()).toBe("B2");
	});

	it("starts at A1 when nothing is selected", async () => {
		await mount(grid());
		key(editor.root, "ArrowDown");
		expect(selected()).toBe("A1");
	});

	it("moves with Tab and Shift+Tab and prevents focus leaving", async () => {
		await mount(grid());
		mouse(td("B1"), "mousedown");
		const evt = key(editor.root, "Tab");
		expect(evt.defaultPrevented).toBe(true);
		expect(selected()).toBe("C1");
		key(editor.root, "Tab", { shiftKey: true });
		expect(selected()).toBe("B1");
	});

	it("selects every cell with Ctrl+A", async () => {
		const m = grid();
		m.merge(r("B3:C3"));
		await mount(m);
		const evt = key(editor.root, "a", { ctrlKey: true });
		expect(evt.defaultPrevented).toBe(true);
		expect(selected()).toBe("A1:C3");
		expect(container.querySelectorAll("td.is-selected")).toHaveLength(8);
	});

	it("clears the selection with Escape", async () => {
		await mount(grid());
		mouse(td("B1"), "mousedown");
		key(editor.root, "Escape");
		expect(selected()).toBeNull();
		expect(container.querySelector(".is-selected")).toBeNull();
	});

	it("leaves unhandled keys alone", async () => {
		await mount(grid());
		expect(key(editor.root, "Enter").defaultPrevented).toBe(false);
		expect(key(editor.root, "x").defaultPrevented).toBe(false);
	});
});

describe("editing cells", () => {
	it("opens a textarea with the raw markdown on double-click", async () => {
		const m = grid();
		m.setCell(1, 1, "**bold**");
		await mount(m);
		mouse(td("B2"), "dblclick");
		expect(editor.isEditing).toBe(true);
		expect(input().value).toBe("**bold**");
		expect(document.activeElement).toBe(input());
	});

	it("commits with Enter, saves, and moves down", async () => {
		await mount(grid());
		mouse(td("B1"), "mousedown");
		key(editor.root, "Enter");
		input().value = "new value";
		key(input(), "Enter");
		await flush();

		expect(onChange).toHaveBeenCalledTimes(1);
		const [savedModel, state] = onChange.mock.calls[0]!;
		expect(savedModel.getCell(0, 1)).toBe("new value");
		expect(state.selection?.focus).toEqual({ row: 1, col: 1 });
		expect(state.focused).toBe(true);
		expect(td("B1").textContent).toBe("new value");
		expect(selected()).toBe("B2");
		expect(editor.isEditing).toBe(false);
	});

	it("keeps newlines typed with Shift+Enter", async () => {
		await mount(grid());
		mouse(td("A1"), "dblclick");
		const evt = key(input(), "Enter", { shiftKey: true });
		expect(evt.defaultPrevented).toBe(false);
		expect(editor.isEditing).toBe(true);
	});

	it("commits with Tab and moves right", async () => {
		await mount(grid());
		mouse(td("A1"), "dblclick");
		input().value = "x";
		key(input(), "Tab");
		await flush();
		expect(editor.currentModel.getCell(0, 0)).toBe("x");
		expect(selected()).toBe("B1");
	});

	it("cancels with Escape without saving", async () => {
		await mount(grid());
		mouse(td("A1"), "dblclick");
		input().value = "discarded";
		key(input(), "Escape");
		await flush();
		expect(onChange).not.toHaveBeenCalled();
		expect(td("A1").textContent).toBe("A1");
		expect(editor.isEditing).toBe(false);
	});

	it("does not save when the text is unchanged", async () => {
		await mount(grid());
		mouse(td("A1"), "dblclick");
		key(input(), "Enter");
		await flush();
		expect(onChange).not.toHaveBeenCalled();
		expect(selected()).toBe("A2");
	});

	it("commits when focus leaves the textarea", async () => {
		await mount(grid());
		mouse(td("A1"), "dblclick");
		input().value = "blurred";
		input().dispatchEvent(new FocusEvent("blur"));
		await flush();
		expect(editor.currentModel.getCell(0, 0)).toBe("blurred");
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it("commits when another cell is clicked", async () => {
		await mount(grid());
		mouse(td("A1"), "dblclick");
		input().value = "first";
		mouse(td("C3"), "mousedown");
		await flush();
		expect(editor.currentModel.getCell(0, 0)).toBe("first");
		expect(selected()).toBe("C3");
	});

	it("starts editing with the typed character replacing the content", async () => {
		await mount(grid());
		mouse(td("B2"), "mousedown");
		const evt = key(editor.root, "Z");
		expect(evt.defaultPrevented).toBe(true);
		expect(input().value).toBe("Z");
	});

	it("does not start editing on Ctrl+key shortcuts it does not know", async () => {
		await mount(grid());
		mouse(td("B2"), "mousedown");
		key(editor.root, "c", { ctrlKey: true });
		expect(editor.isEditing).toBe(false);
	});

	it("edits the anchor of a merged cell", async () => {
		const m = grid();
		m.merge(r("A1:B2"));
		await mount(m);
		editor.startEdit({ row: 1, col: 1 });
		expect(input().value).toBe("A1");
		expect(input().closest("td")!.dataset.col).toBe("0");
	});

	it("formats the text being edited with Ctrl+B, Ctrl+I and Ctrl+K", async () => {
		await mount(grid());
		mouse(td("A1"), "dblclick");
		const el = input();
		el.value = "make this bold";
		el.setSelectionRange(5, 9);

		const evt = key(el, "b", { ctrlKey: true });
		expect(evt.defaultPrevented).toBe(true);
		expect(el.value).toBe("make **this** bold");
		expect([el.selectionStart, el.selectionEnd]).toEqual([7, 11]);

		key(el, "i", { metaKey: true });
		expect(el.value).toBe("make ***this*** bold");

		key(el, "b", { ctrlKey: true });
		key(el, "i", { ctrlKey: true });
		expect(el.value).toBe("make this bold");

		key(el, "k", { ctrlKey: true });
		expect(el.value).toBe("make [this]() bold");

		// Still editing, and nothing was saved yet.
		expect(editor.isEditing).toBe(true);
		expect(onChange).not.toHaveBeenCalled();
		expect(editor.currentModel.getStyle(0, 0)).toEqual({});
	});

	it("saves formatting typed with shortcuts", async () => {
		await mount(grid());
		mouse(td("A1"), "dblclick");
		input().setSelectionRange(0, 2);
		key(input(), "b", { ctrlKey: true });
		key(input(), "Enter");
		await flush();
		expect(editor.currentModel.getCell(0, 0)).toBe("**A1**");
	});

	it("does not let keys inside the textarea reach the table handler", async () => {
		await mount(grid());
		mouse(td("A1"), "dblclick");
		key(input(), "ArrowDown");
		expect(selected()).toBe("A1");
		expect(editor.isEditing).toBe(true);
	});
});

describe("changes", () => {
	it("clears the selected content with Delete", async () => {
		await mount(grid());
		mouse(td("A1"), "mousedown");
		mouse(td("B2"), "mousedown", { shiftKey: true });
		key(editor.root, "Delete");
		await flush();
		const rows = editor.currentModel.toData().rows;
		expect(rows[0]).toEqual(["", "", "C1"]);
		expect(rows[1]).toEqual(["", "", "C2"]);
		expect(selected()).toBe("A1:B2");
	});

	it("toggles bold with Ctrl+B", async () => {
		await mount(grid());
		mouse(td("A1"), "mousedown");
		key(editor.root, "b", { ctrlKey: true });
		await flush();
		expect(editor.currentModel.getStyle(0, 0)).toEqual({ bold: true });
		expect(td("A1").style.fontWeight).toBe("bold");
	});

	it("runs actions on the selection", async () => {
		await mount(grid());
		mouse(td("A1"), "mousedown");
		mouse(td("B1"), "mousedown", { shiftKey: true });
		expect(await editor.runAction("merge")).toBe(true);
		expect(td("A1").colSpan).toBe(2);
		expect(container.querySelector('td[data-row="0"][data-col="1"]')).toBeNull();
	});

	it("refuses disabled or unknown actions", async () => {
		await mount(grid());
		expect(await editor.runAction("merge")).toBe(false); // no selection
		mouse(td("A1"), "mousedown");
		expect(await editor.runAction("merge")).toBe(false); // single cell
		expect(await editor.runAction("nope")).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("keeps the selection inside the table after deleting rows", async () => {
		await mount(grid());
		mouse(td("A3"), "mousedown");
		await editor.runAction("delete-rows");
		expect(editor.currentModel.rowCount).toBe(2);
		expect(selected()).toBe("A2");
	});

	it("rolls back when saving fails", async () => {
		await mount(grid());
		onChange.mockResolvedValueOnce(false);
		mouse(td("A1"), "mousedown");
		key(editor.root, "Delete");
		await flush();
		expect(editor.currentModel.getCell(0, 0)).toBe("A1");
		expect(td("A1").textContent).toBe("A1");
	});

	it("reports errors thrown by a change and keeps the model", async () => {
		const onError = vi.fn();
		await mount(grid(), { onError });
		const ok = await editor.applyChange(() => {
			throw new Error("boom");
		});
		expect(ok).toBe(false);
		expect(onError).toHaveBeenCalledWith(new Error("boom"));
		expect(onChange).not.toHaveBeenCalled();
	});

	it("never mutates the model it was given", async () => {
		const original = grid();
		await mount(original);
		mouse(td("A1"), "mousedown");
		key(editor.root, "Delete");
		await flush();
		expect(original.getCell(0, 0)).toBe("A1");
	});
});

describe("context menu", () => {
	it("selects the clicked cell when it is outside the selection", async () => {
		const onContextMenu = vi.fn();
		await mount(grid(), { onContextMenu });
		mouse(td("A1"), "mousedown");
		const evt = mouse(td("C3"), "contextmenu");
		expect(evt.defaultPrevented).toBe(true);
		expect(selected()).toBe("C3");
		expect(formatRange(onContextMenu.mock.calls[0]![1])).toBe("C3");
	});

	it("keeps a selection that contains the clicked cell", async () => {
		const onContextMenu = vi.fn();
		await mount(grid(), { onContextMenu });
		mouse(td("A1"), "mousedown");
		mouse(td("B2"), "mousedown", { shiftKey: true });
		mouse(td("B1"), "contextmenu");
		expect(formatRange(onContextMenu.mock.calls[0]![1])).toBe("A1:B2");
	});

	it("leaves the native menu alone without a handler", async () => {
		await mount(grid());
		expect(mouse(td("A1"), "contextmenu").defaultPrevented).toBe(false);
	});
});

describe("column resizing", () => {
	/** Lays out the rendered cells as a row of 100px columns starting at x=0. */
	function layout(width = 100) {
		for (const cell of Array.from(container.querySelectorAll<HTMLTableCellElement>("td[data-col]"))) {
			const col = Number(cell.dataset.col);
			const left = col * width;
			const right = left + width * cell.colSpan;
			cell.getBoundingClientRect = () => ({ left, right, width: right - left }) as DOMRect;
		}
	}

	function drag(target: Element, fromX: number, toX: number) {
		mouse(target, "mousedown", { clientX: fromX });
		mouse(document.body, "mousemove", { clientX: (fromX + toX) / 2 });
		mouse(document.body, "mousemove", { clientX: toX });
		mouse(document.body, "mouseup", { clientX: toX });
	}

	it("shows the resize cursor near a border", async () => {
		await mount(grid());
		layout();
		mouse(td("A1"), "mousemove", { clientX: 98 });
		expect(editor.root.classList.contains("is-resize-hover")).toBe(true);
		mouse(td("A1"), "mousemove", { clientX: 50 });
		expect(editor.root.classList.contains("is-resize-hover")).toBe(false);
	});

	it("drags a border, updating live and saving once", async () => {
		await mount(grid());
		layout();
		mouse(td("A1"), "mousedown", { clientX: 100 });
		expect(selected()).toBeNull();
		mouse(document.body, "mousemove", { clientX: 160 });

		const table = container.querySelector<HTMLTableElement>("table")!;
		expect(table.style.tableLayout).toBe("fixed");
		expect(table.querySelector<HTMLTableColElement>("col")!.style.width).toBe("160px");
		expect(onChange).not.toHaveBeenCalled();

		mouse(document.body, "mouseup", { clientX: 160 });
		await flush();
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(editor.currentModel.columnWidths).toEqual([160, 100, 100]);
	});

	it("resizes the last column of a merged cell from its right border", async () => {
		const m = grid();
		m.merge(parseRange("A1:B1"));
		await mount(m);
		layout();
		drag(td("A1"), 200, 250);
		await flush();
		expect(editor.currentModel.columnWidths).toEqual([100, 150, 100]);
	});

	it("resizes the previous column from a left border", async () => {
		await mount(grid());
		layout();
		drag(td("B2"), 101, 71);
		await flush();
		expect(editor.currentModel.columnWidths).toEqual([70, 100, 100]);
	});

	it("starts from stored widths once they exist", async () => {
		const m = grid();
		m.setColumnWidth(0, 50);
		await mount(m);
		layout(); // rendered positions are ignored in favour of stored widths
		drag(td("C1"), 300, 320);
		await flush();
		expect(editor.currentModel.columnWidths).toEqual([50, 120, 140]);
	});

	it("does not save a click on a border without movement", async () => {
		await mount(grid());
		layout();
		drag(td("A1"), 100, 100);
		await flush();
		expect(onChange).not.toHaveBeenCalled();
	});

	it("does not start editing on a double-click at a border", async () => {
		await mount(grid());
		layout();
		mouse(td("A1"), "dblclick", { clientX: 99 });
		expect(editor.isEditing).toBe(false);
	});

	it("still selects cells away from the borders", async () => {
		await mount(grid());
		layout();
		mouse(td("B2"), "mousedown", { clientX: 150 });
		expect(selected()).toBe("B2");
	});
});

describe("host shortcuts", () => {
	it("formats the edited text through handleShortcut", async () => {
		await mount(grid());
		mouse(td("A1"), "dblclick");
		input().setSelectionRange(0, 2);
		expect(editor.handleShortcut("b")).toBe(true);
		expect(input().value).toBe("**A1**");
		expect(editor.handleShortcut("a")).toBe(true);
		expect([input().selectionStart, input().selectionEnd]).toEqual([0, 6]);
	});

	it("styles selected cells and selects all when not editing", async () => {
		await mount(grid());
		expect(editor.handleShortcut("b")).toBe(false); // nothing selected
		expect(editor.handleShortcut("a")).toBe(true);
		expect(selected()).toBe("A1:C3");
		expect(editor.handleShortcut("i")).toBe(true);
		await flush();
		expect(editor.currentModel.getStyle(2, 2)).toEqual({ italic: true });
		expect(editor.handleShortcut("k")).toBe(false);
	});

	it("does not apply a shortcut twice when the host already handled it", async () => {
		await mount(grid());
		mouse(td("A1"), "dblclick");
		input().setSelectionRange(0, 2);
		const evt = new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true });
		evt.preventDefault(); // as Obsidian's keymap does after running the scope handler
		input().dispatchEvent(evt);
		expect(input().value).toBe("A1");
	});

	it("swallows the shortcuts so they never reach the note", async () => {
		await mount(grid());
		const outside = vi.fn();
		document.body.addEventListener("keydown", outside);
		mouse(td("A1"), "mousedown");
		for (const k of ["b", "i", "k", "a"]) key(editor.root, k, { ctrlKey: true });
		mouse(td("A1"), "dblclick");
		for (const k of ["b", "i", "k", "a"]) key(input(), k, { ctrlKey: true });
		expect(outside).not.toHaveBeenCalled();
		document.body.removeEventListener("keydown", outside);
	});

	it("reports focus entering and leaving, but not moves inside", async () => {
		const onFocusChange = vi.fn();
		await mount(grid(), { onFocusChange });
		const elsewhere = document.createElement("button");
		document.body.appendChild(elsewhere);

		mouse(td("A1"), "mousedown");
		expect(onFocusChange.mock.calls).toEqual([[true]]);
		mouse(td("A1"), "dblclick"); // focus moves to the textarea
		key(input(), "Escape"); // and back to the table
		expect(onFocusChange.mock.calls).toEqual([[true]]);

		elsewhere.focus();
		expect(onFocusChange.mock.calls).toEqual([[true], [false]]);
	});

	it("notices focus moving elsewhere even without a focusout", async () => {
		const onFocusChange = vi.fn();
		await mount(grid(), { onFocusChange });
		mouse(td("A1"), "mousedown");
		expect(editor.containsFocus).toBe(true);
		const elsewhere = document.createElement("input");
		document.body.appendChild(elsewhere);
		elsewhere.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
		expect(onFocusChange.mock.calls).toEqual([[true], [false]]);
	});

	it("reports losing focus when destroyed while focused", async () => {
		const onFocusChange = vi.fn();
		await mount(grid(), { onFocusChange });
		mouse(td("A1"), "mousedown");
		editor.destroy();
		expect(onFocusChange.mock.calls).toEqual([[true], [false]]);
	});
});

describe("images", () => {
	const png = () => new File(["x"], "image.png", { type: "image/png" });

	/** A paste or drop event carrying files (happy-dom has no real clipboard). */
	function transferEvent(type: "paste" | "drop" | "dragover", files: File[], types = ["Files"]) {
		const evt = new Event(type, { bubbles: true, cancelable: true });
		const data = { files, types, dropEffect: "none" };
		Object.defineProperty(evt, type === "paste" ? "clipboardData" : "dataTransfer", { value: data });
		return evt;
	}

	function mountWithImages(onInsertFiles = vi.fn(async (files: File[]) => files.map((_, i) => `![[img${i}.png]]`))) {
		return mount(grid(), { onInsertFiles }).then(() => onInsertFiles);
	}

	it("inserts pasted images at the cursor while editing", async () => {
		const onInsertFiles = await mountWithImages();
		mouse(td("A1"), "dblclick");
		input().value = "before after";
		input().setSelectionRange(7, 7);
		const evt = transferEvent("paste", [png()]);
		input().dispatchEvent(evt);
		await flush();
		expect(evt.defaultPrevented).toBe(true);
		expect(onInsertFiles).toHaveBeenCalledTimes(1);
		expect(input().value).toBe("before ![[img0.png]]after");
		expect(onChange).not.toHaveBeenCalled();
	});

	it("appends pasted images to the selected cell when not editing", async () => {
		await mountWithImages();
		mouse(td("B2"), "mousedown");
		editor.root.dispatchEvent(transferEvent("paste", [png(), png()]));
		await flush();
		expect(editor.currentModel.getCell(1, 1)).toBe("B2\n![[img0.png]]\n![[img1.png]]");
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it("appends dropped images to the cell under the pointer", async () => {
		const m = grid();
		m.merge(r("B2:C3"));
		const onInsertFiles = vi.fn(async () => ["![[drop.png]]"]);
		await mount(m, { onInsertFiles });
		const over = transferEvent("dragover", [png()]);
		td("B2").dispatchEvent(over);
		expect(over.defaultPrevented).toBe(true);
		const drop = transferEvent("drop", [png()]);
		td("B2").dispatchEvent(drop);
		await flush();
		expect(drop.defaultPrevented).toBe(true);
		expect(editor.currentModel.getCell(1, 1)).toBe("B2\n![[drop.png]]");
		expect(selected()).toBe("B2:C3");
	});

	it("saves an open edit before dropping into another cell", async () => {
		await mountWithImages();
		mouse(td("A1"), "dblclick");
		input().value = "edited";
		td("C3").dispatchEvent(transferEvent("drop", [png()]));
		await flush();
		expect(editor.currentModel.getCell(0, 0)).toBe("edited");
		expect(editor.currentModel.getCell(2, 2)).toBe("C3\n![[img0.png]]");
	});

	it("leaves text pastes and non-image drops to the browser", async () => {
		const onInsertFiles = await mountWithImages();
		mouse(td("A1"), "dblclick");
		const text = transferEvent("paste", [], ["text/plain"]);
		input().dispatchEvent(text);
		const pdf = transferEvent("drop", [new File(["x"], "a.pdf", { type: "application/pdf" })]);
		td("B1").dispatchEvent(pdf);
		expect(text.defaultPrevented).toBe(false);
		expect(pdf.defaultPrevented).toBe(false);
		expect(onInsertFiles).not.toHaveBeenCalled();
	});

	it("does nothing without a host to store files", async () => {
		await mount(grid());
		mouse(td("A1"), "mousedown");
		const evt = transferEvent("paste", [png()]);
		editor.root.dispatchEvent(evt);
		expect(evt.defaultPrevented).toBe(false);
	});

	it("reports storage errors and changes nothing", async () => {
		const onError = vi.fn();
		await mount(grid(), { onError, onInsertFiles: vi.fn(async () => Promise.reject(new Error("disk full"))) });
		mouse(td("A1"), "mousedown");
		editor.root.dispatchEvent(transferEvent("paste", [png()]));
		await flush();
		expect(onError).toHaveBeenCalledWith(new Error("disk full"));
		expect(editor.currentModel.getCell(0, 0)).toBe("A1");
	});

	it("appends markdown to the selected cell", async () => {
		await mount(grid());
		expect(await editor.appendToSelectedCell("![[x.png]]")).toBe(false); // nothing selected
		mouse(td("C1"), "mousedown");
		expect(await editor.appendToSelectedCell("![[x.png]]")).toBe(true);
		expect(editor.currentModel.getCell(0, 2)).toBe("C1\n![[x.png]]");
	});
});

describe("destroy", () => {
	it("removes the editor and stops listening", async () => {
		await mount(grid());
		editor.destroy();
		expect(container.querySelector(".dream-table-editor")).toBeNull();
	});
});

describe("collapse", () => {
	function withHeader(): TableModel {
		const m = grid();
		m.setHeaderRows(1);
		return m;
	}

	it("saves the toggle from the header button without selecting the cell", async () => {
		await mount(withHeader());
		const button = container.querySelector<HTMLButtonElement>(".dream-table-collapse")!;
		mouse(button, "mousedown");
		expect(selected()).toBeNull();
		button.click();
		await flush();
		expect(onChange).toHaveBeenCalledTimes(1);
		expect(onChange.mock.calls[0]![0].collapsed).toBe(true);
		expect(container.querySelector("table")!.classList.contains("is-collapsed")).toBe(true);
	});

	it("keeps keyboard navigation inside the header while collapsed", async () => {
		const m = withHeader();
		m.collapsed = true;
		await mount(m);
		editor.select({ row: 0, col: 0 });
		key(editor.root, "ArrowDown");
		expect(selected()).toBe("A1");
		editor.selectAll();
		expect(selected()).toBe("A1:C1");
	});

	it("moves a selection out of the hidden rows when collapsing", async () => {
		await mount(withHeader());
		editor.select({ row: 2, col: 1 });
		await editor.toggleCollapsed();
		expect(selected()).toBe("B1");
	});
});

describe("clicking outside", () => {
	it("clears the selection", async () => {
		await mount(grid());
		mouse(td("B2"), "mousedown");
		expect(selected()).toBe("B2");
		mouse(document.body, "mousedown");
		expect(selected()).toBeNull();
		expect(td("B2").classList.contains("is-selected")).toBe(false);
	});

	it("keeps the selection on elements the host claims, like its menus", async () => {
		const menu = document.createElement("div");
		menu.className = "menu";
		document.body.appendChild(menu);
		await mount(grid(), { keepsSelection: (el) => el.closest(".menu") !== null });
		mouse(td("B2"), "mousedown");
		mouse(menu, "mousedown");
		expect(selected()).toBe("B2");
	});

	it("saves an open edit and lets go of the selection and focus", async () => {
		await mount(grid());
		editor.startEdit({ row: 0, col: 0 });
		input().value = "changed";
		mouse(document.body, "mousedown");
		await flush();
		expect(editor.currentModel.getCell(0, 0)).toBe("changed");
		expect(selected()).toBeNull();
		expect(onChange.mock.calls[0]![1]).toMatchObject({ selection: null, focused: false });
		expect(editor.containsFocus).toBe(false);
	});

	it("stops listening once destroyed", async () => {
		await mount(grid());
		editor.select({ row: 1, col: 1 });
		editor.destroy();
		mouse(document.body, "mousedown");
		expect(selected()).toBe("B2");
	});
});
