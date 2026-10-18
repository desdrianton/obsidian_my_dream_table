import { describe, expect, it } from "vitest";
import { formatRange, parseRange } from "../../src/model/address";
import { TableModel } from "../../src/model/TableModel";
import {
	clearContent,
	setBorder,
	setColor,
	setLineHeight,
	setPadding,
	TABLE_ACTIONS,
	type TableAction,
} from "../../src/editor/actions";

const r = parseRange;

function action(id: string): TableAction {
	const found = TABLE_ACTIONS.find((a) => a.id === id);
	if (!found) throw new Error(`No action ${id}`);
	return found;
}

function enabled(id: string, model: TableModel, range: string): boolean {
	const a = action(id);
	return a.isEnabled ? a.isEnabled(model, r(range)) : true;
}

function run(id: string, model: TableModel, range: string): string | undefined {
	const result = action(id).run(model, r(range));
	return result ? formatRange(result) : undefined;
}

/** 3x3 grid whose cells hold their own address. */
function grid(): TableModel {
	const m = TableModel.create(3, 3);
	for (let row = 0; row < 3; row++) {
		for (let col = 0; col < 3; col++) m.setCell(row, col, formatRange({ top: row, left: col, bottom: row, right: col }));
	}
	return m;
}

it("has unique ids", () => {
	const ids = TABLE_ACTIONS.map((a) => a.id);
	expect(new Set(ids).size).toBe(ids.length);
});

describe("merge / unmerge", () => {
	it("merge is enabled only for multi-cell ranges that are not already one merge", () => {
		const m = grid();
		expect(enabled("merge", m, "A1")).toBe(false);
		expect(enabled("merge", m, "A1:B2")).toBe(true);
		m.merge(r("A1:B2"));
		expect(enabled("merge", m, "A1:B2")).toBe(false);
		expect(enabled("merge", m, "A1:C2")).toBe(true);
	});

	it("unmerge is enabled only when a merge is touched", () => {
		const m = grid();
		expect(enabled("unmerge", m, "A1:C3")).toBe(false);
		m.merge(r("B2:C2"));
		expect(enabled("unmerge", m, "C2")).toBe(true);
		expect(run("unmerge", m, "C2")).toBe("C2");
		expect(m.merges).toEqual([]);
	});

	it("merge keeps the merged range selected", () => {
		const m = grid();
		expect(run("merge", m, "A1:B1")).toBe("A1:B1");
		expect(m.getCell(0, 0)).toBe("A1");
		expect(m.getCell(0, 1)).toBe("");
	});
});

describe("insert", () => {
	it("inserts a row above and selects it", () => {
		const m = grid();
		expect(run("insert-row-above", m, "B2:C3")).toBe("B2");
		expect(m.rowCount).toBe(4);
		expect(m.getCell(1, 1)).toBe("");
		expect(m.getCell(2, 1)).toBe("B2");
	});

	it("inserts a row below the selection", () => {
		const m = grid();
		expect(run("insert-row-below", m, "B1:B2")).toBe("B3");
		expect(m.getCell(2, 1)).toBe("");
		expect(m.getCell(3, 1)).toBe("B3");
	});

	it("inserts columns left and right", () => {
		const m = grid();
		expect(run("insert-column-left", m, "B1")).toBe("B1");
		expect(m.getCell(0, 2)).toBe("B1");
		expect(run("insert-column-right", m, "C1")).toBe("D1");
		expect(m.colCount).toBe(5);
		expect(m.getCell(0, 3)).toBe("");
	});
});

describe("delete", () => {
	it("deletes every row in the selection", () => {
		const m = grid();
		expect(run("delete-rows", m, "B1:B2")).toBe("B1");
		expect(m.rowCount).toBe(1);
		expect(m.getCell(0, 0)).toBe("A3");
	});

	it("deletes columns and clamps the new selection", () => {
		const m = grid();
		expect(run("delete-columns", m, "B1:C1")).toBe("A1");
		expect(m.colCount).toBe(1);
	});

	it("never deletes every row or column", () => {
		const m = grid();
		expect(enabled("delete-rows", m, "A1:A3")).toBe(false);
		expect(enabled("delete-rows", m, "A1:A2")).toBe(true);
		expect(enabled("delete-columns", m, "A1:C1")).toBe(false);
	});

	it("clears content but keeps structure", () => {
		const m = grid();
		m.merge(r("A1:B1"));
		clearContent(m, r("A1:C1"));
		expect(m.toData().rows[0]).toEqual(["", "", ""]);
		expect(m.merges).toHaveLength(1);
		expect(m.getCell(1, 0)).toBe("A2");
	});
});

describe("reset-widths", () => {
	it("is enabled only when a width is set, and clears all widths", () => {
		const m = grid();
		expect(enabled("reset-widths", m, "A1")).toBe(false);
		m.setColumnWidth(1, 200);
		expect(enabled("reset-widths", m, "A1")).toBe(true);
		run("reset-widths", m, "A1");
		expect(m.hasColumnWidths).toBe(false);
	});
});

describe("formatting", () => {
	it("toggles bold based on the top-left cell", () => {
		const m = grid();
		expect(action("bold").isChecked!(m, r("A1:B1"))).toBe(false);
		run("bold", m, "A1:B1");
		expect(m.getStyle(0, 1)).toEqual({ bold: true });
		expect(action("bold").isChecked!(m, r("A1:B1"))).toBe(true);
		run("bold", m, "A1:B1");
		expect(m.getStyle(0, 1)).toEqual({});
		expect(m.styles).toEqual([]);
	});

	it("toggles italic", () => {
		const m = grid();
		run("italic", m, "B2");
		expect(m.getStyle(1, 1)).toEqual({ italic: true });
	});

	it("sets alignment, with left meaning the default", () => {
		const m = grid();
		expect(action("align-left").isChecked!(m, r("A1"))).toBe(true);
		run("align-right", m, "A1:C1");
		expect(m.getStyle(0, 2)).toEqual({ align: "right" });
		expect(action("align-right").isChecked!(m, r("A1"))).toBe(true);
		expect(action("align-left").isChecked!(m, r("A1"))).toBe(false);
		run("align-left", m, "A1:C1");
		expect(m.styles).toEqual([]);
	});

	it("clears formatting only when something is styled", () => {
		const m = grid();
		expect(enabled("clear-formatting", m, "A1:C3")).toBe(false);
		run("bold", m, "B2");
		expect(enabled("clear-formatting", m, "A1:C3")).toBe(true);
		run("clear-formatting", m, "A1:C3");
		expect(m.styles).toEqual([]);
	});

	it("sets and removes cell borders", () => {
		const m = grid();
		m.updateTableBorder({ color: "gray", width: 1 });
		setBorder(m, r("A1:B1"), { color: "red", width: 3, style: "double" });
		expect(m.getBorder(0, 1)).toEqual({ color: "red", width: 3, style: "double" });
		setBorder(m, r("A1:B1"), { color: null, width: null, style: null });
		expect(m.getBorder(0, 1)).toEqual({ color: "gray", width: 1 });
		expect(m.styles).toEqual([]);
	});

	it("sets, rounds, and removes cell line height", () => {
		const m = grid();
		m.tableLineHeight = 1.5;
		setLineHeight(m, r("A1:B1"), 1.999);
		expect(m.getLineHeight(0, 1)).toBe(2);
		setLineHeight(m, r("A1:B1"), null);
		expect(m.getLineHeight(0, 1)).toBe(1.5);
		expect(m.styles).toEqual([]);
	});

	it("sets and removes cell padding", () => {
		const m = grid();
		m.tablePadding = 10;
		setPadding(m, r("A1:B1"), 0);
		expect(m.getPadding(0, 1)).toBe(0);
		setPadding(m, r("A1:B1"), null);
		expect(m.getPadding(0, 1)).toBe(10);
		expect(m.styles).toEqual([]);
	});

	it("sets and removes colors", () => {
		const m = grid();
		setColor(m, r("A1:B1"), "bg", "rgba(var(--color-red-rgb), 0.2)");
		setColor(m, r("A1"), "fg", "var(--color-blue)");
		expect(m.getStyle(0, 0)).toEqual({ bg: "rgba(var(--color-red-rgb), 0.2)", fg: "var(--color-blue)" });
		setColor(m, r("A1:B1"), "bg", null);
		expect(m.getStyle(0, 1)).toEqual({});
	});
});

it("produces data that passes validation after every action", () => {
	for (const a of TABLE_ACTIONS) {
		const m = grid();
		m.merge(r("B2:C2"));
		const range = m.expandToMerges(r("B2"));
		if (a.isEnabled && !a.isEnabled(m, range)) continue;
		a.run(m, range);
		const reparsed = TableModel.parse(m.toData());
		expect(reparsed.ok, a.id).toBe(true);
	}
});

describe("header actions", () => {
	it("makes the rows up to the selection the header", () => {
		const m = grid();
		expect(enabled("set-header", m, "B2")).toBe(true);
		run("set-header", m, "B2");
		expect(m.headerRows).toBe(2);
		expect(enabled("set-header", m, "A2")).toBe(false);
	});

	it("is disabled when the header would cut a merge", () => {
		const m = grid();
		m.merge(r("A1:A2"));
		expect(enabled("set-header", m, "B1")).toBe(false);
	});

	it("removes the header and toggles collapse", () => {
		const m = grid();
		expect(enabled("remove-header", m, "A1")).toBe(false);
		expect(enabled("toggle-collapse", m, "A1")).toBe(false);
		m.setHeaderRows(1);
		run("toggle-collapse", m, "A1");
		expect(m.collapsed).toBe(true);
		expect(action("toggle-collapse").isChecked!(m, r("A1"))).toBe(true);
		run("remove-header", m, "A1");
		expect(m.headerRows).toBe(0);
		expect(m.collapsed).toBe(false);
	});
});
