// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
	hitColumnEdge,
	measureColumnWidths,
	MIN_DRAG_WIDTH,
	resizedWidths,
	startingWidths,
} from "../../src/editor/resize";
import { DEFAULT_COLUMN_WIDTH } from "../../src/render/renderTable";

describe("hitColumnEdge", () => {
	const rect = { left: 100, right: 200 };

	it("grabs the right border of the cell's last column", () => {
		expect(hitColumnEdge(rect, 200, 2, 1)).toBe(2);
		expect(hitColumnEdge(rect, 196, 2, 1)).toBe(2);
		expect(hitColumnEdge(rect, 204, 2, 1)).toBe(2);
		expect(hitColumnEdge(rect, 199, 2, 3)).toBe(4);
	});

	it("grabs the left border as the previous column", () => {
		expect(hitColumnEdge(rect, 102, 2, 1)).toBe(1);
	});

	it("does not grab the left border of the first column", () => {
		expect(hitColumnEdge(rect, 101, 0, 1)).toBeNull();
	});

	it("ignores the middle of the cell", () => {
		expect(hitColumnEdge(rect, 150, 2, 1)).toBeNull();
		expect(hitColumnEdge(rect, 194, 2, 1)).toBeNull();
	});

	it("keeps narrow cells clickable", () => {
		const narrow = { left: 100, right: 109 }; // reach = 3px
		expect(hitColumnEdge(narrow, 104, 1, 1)).toBeNull();
		expect(hitColumnEdge(narrow, 107, 1, 1)).toBe(1);
	});

	it("ignores cells that are not laid out", () => {
		expect(hitColumnEdge({ left: 0, right: 0 }, 0, 1, 1)).toBeNull();
	});
});

describe("resizedWidths", () => {
	it("changes only the dragged column", () => {
		expect(resizedWidths([100, 100, 100], 1, 30.6)).toEqual([100, 131, 100]);
	});

	it("never goes below the minimum", () => {
		expect(resizedWidths([100, 100], 0, -500)).toEqual([MIN_DRAG_WIDTH, 100]);
	});
});

describe("startingWidths", () => {
	it("measures when nothing is stored", () => {
		expect(startingWidths([null, null], () => [70, 90])).toEqual([70, 90]);
	});

	it("uses stored widths, with the default for automatic columns", () => {
		expect(startingWidths([150, null], () => [1, 1])).toEqual([150, DEFAULT_COLUMN_WIDTH]);
	});
});

describe("measureColumnWidths", () => {
	function cell(col: number, width: number, colSpan = 1): HTMLTableCellElement {
		const td = document.createElement("td");
		td.dataset.col = String(col);
		td.colSpan = colSpan;
		td.getBoundingClientRect = () => ({ width }) as DOMRect;
		return td;
	}

	function table(...rows: HTMLTableCellElement[][]): HTMLTableElement {
		const t = document.createElement("table");
		for (const cells of rows) {
			const tr = t.insertRow();
			for (const td of cells) tr.appendChild(td);
		}
		return t;
	}

	it("reads unmerged cells", () => {
		expect(measureColumnWidths(table([cell(0, 80.4), cell(1, 120)]), 2)).toEqual([80, 120]);
	});

	it("splits a merged cell across columns that have no plain cell", () => {
		const t = table([cell(0, 150, 3)], [cell(0, 50), cell(1, 100, 2)]);
		expect(measureColumnWidths(t, 3)).toEqual([50, 50, 50]);
	});

	it("subtracts known columns before sharing a merge's width", () => {
		const t = table([cell(0, 300, 3)], [cell(0, 60), cell(1, 240, 2)]);
		// B:C (narrower) is shared first: 120 each. A:C then has nothing left to assign.
		expect(measureColumnWidths(t, 3)).toEqual([60, 120, 120]);
		const u = table([cell(0, 300, 3)], [cell(1, 100)]);
		// A and C share 300 - 100.
		expect(measureColumnWidths(u, 3)).toEqual([100, 100, 100]);
	});

	it("falls back to the default width", () => {
		expect(measureColumnWidths(table([cell(0, 0)]), 2)).toEqual([DEFAULT_COLUMN_WIDTH, DEFAULT_COLUMN_WIDTH]);
	});
});
