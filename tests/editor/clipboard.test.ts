import { describe, expect, it } from "vitest";
import { parseRange } from "../../src/model/address";
import { TableModel } from "../../src/model/TableModel";
import {
	CELLS_FORMAT,
	copyCells,
	fillCells,
	parseTsv,
	pasteCells,
	readCells,
	toTsv,
	writeCells,
} from "../../src/editor/clipboard";

const r = parseRange;

describe("toTsv / parseTsv", () => {
	it("joins cells with tabs and rows with line breaks", () => {
		expect(toTsv([["a", "b"], ["c", ""]])).toBe("a\tb\nc\t");
		expect(parseTsv("a\tb\nc\t")).toEqual([["a", "b"], ["c", ""]]);
	});

	it("quotes cells with tabs, line breaks or a leading quote", () => {
		const cells = [["line 1\nline 2", 'say "hi"'], ['"quoted"', "a\tb"]];
		const text = toTsv(cells);
		expect(text).toBe('"line 1\nline 2"\tsay "hi"\n"""quoted"""\t"a\tb"');
		expect(parseTsv(text)).toEqual(cells);
	});

	it("reads spreadsheet text: CRLF, a trailing line break, ragged rows", () => {
		expect(parseTsv("a\tb\r\nc\r\n")).toEqual([["a", "b"], ["c", ""]]);
	});

	it("takes a leading quote literally when it does not close the field", () => {
		expect(parseTsv('"hello" she said\tx')).toEqual([['"hello" she said', "x"]]);
		expect(parseTsv('"open')).toEqual([['"open']]);
	});
});

describe("copyCells / pasteCells / fillCells", () => {
	function grid(rows: number, cols: number): TableModel {
		const m = TableModel.create(rows, cols);
		for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) m.setCell(row, col, `${row}${col}`);
		return m;
	}

	it("copies a range, leaving cells hidden under a merge empty", () => {
		const m = grid(3, 3);
		m.merge(r("A1:B1"));
		expect(copyCells(m, r("A1:B2"))).toEqual([["00", ""], ["10", "11"]]);
	});

	it("pastes from a cell rightwards and down", () => {
		const m = grid(3, 3);
		expect(pasteCells(m, { row: 1, col: 1 }, [["x", "y"], ["z", "w"]])).toEqual(r("B2:C3"));
		expect(copyCells(m, r("A1:C3"))).toEqual([["00", "01", "02"], ["10", "x", "y"], ["20", "z", "w"]]);
	});

	it("adds rows and columns when the cells do not fit", () => {
		const m = grid(2, 2);
		expect(pasteCells(m, { row: 1, col: 1 }, [["a", "b"], ["c", "d"]])).toEqual(r("B2:C3"));
		expect(m.rowCount).toBe(3);
		expect(m.colCount).toBe(3);
		expect(m.getCell(2, 2)).toBe("d");
	});

	it("does not paste into hidden rows of a collapsed table", () => {
		const m = grid(3, 2);
		m.setHeaderRows(1);
		m.collapsed = true;
		expect(pasteCells(m, { row: 0, col: 0 }, [["a"], ["b"]])).toEqual(r("A1"));
		expect(m.rowCount).toBe(3);
		expect(m.getCell(1, 0)).toBe("10");
	});

	it("skips cells hidden under a merge and returns whole merges", () => {
		const m = grid(3, 3);
		m.merge(r("B1:C2"));
		expect(pasteCells(m, { row: 0, col: 0 }, [["a", "b"], ["c", "d"]])).toEqual(r("A1:C2"));
		expect(m.getCell(0, 1)).toBe("b");
		expect(m.getCell(1, 0)).toBe("c");
	});

	it("fills every cell of several ranges", () => {
		const m = grid(3, 3);
		fillCells(m, [r("A1:B1"), r("C3")], "v");
		expect(copyCells(m, r("A1:C1"))).toEqual([["v", "v", "02"]]);
		expect(m.getCell(2, 2)).toBe("v");
	});
});

describe("writeCells / readCells", () => {
	/** A stand-in clipboard (happy-dom has no real one). */
	function clipboard(store: Record<string, string> = {}) {
		return {
			store,
			getData: (format: string) => store[format] ?? "",
			setData: (format: string, value: string) => void (store[format] = value),
		} as unknown as DataTransfer & { store: Record<string, string> };
	}

	it("copies a single cell as its own text", () => {
		const data = clipboard();
		writeCells(data, [["a\nb"]]);
		expect(data.store["text/plain"]).toBe("a\nb");
		expect(readCells(data)).toEqual({ cells: [["a\nb"]], fromTable: true });
	});

	it("pastes a copied cell holding a tab as one cell", () => {
		const data = clipboard();
		writeCells(data, [["a\tb"]]);
		const pasted = clipboard({ "text/plain": "a\tb", [CELLS_FORMAT]: data.store[CELLS_FORMAT]! });
		expect(readCells(pasted)).toEqual({ cells: [["a\tb"]], fromTable: true });
	});

	it("recognises text copied from a table without the cells format, and parses anything else", () => {
		writeCells(clipboard(), [["a"], ["b"]]);
		expect(readCells(clipboard({ "text/plain": "a\nb" }))).toEqual({ cells: [["a"], ["b"]], fromTable: true });
		expect(readCells(clipboard({ "text/plain": "x\ty" }))).toEqual({ cells: [["x", "y"]], fromTable: false });
	});

	it("ignores malformed cells data", () => {
		const data = clipboard({ "text/plain": "x\ty", [CELLS_FORMAT]: '[["a"],["b","c"]]' });
		expect(readCells(data)).toEqual({ cells: [["x", "y"]], fromTable: false });
	});
});
