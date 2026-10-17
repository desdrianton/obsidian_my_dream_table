import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { parseTableData, type ParseResult } from "../../src/model/schema";
import { serializeTable } from "../../src/model/serialize";
import { TableModel } from "../../src/model/TableModel";

function errors(result: ParseResult): string[] {
	return result.ok ? [] : result.errors;
}

function model(input: unknown): TableModel {
	const result = TableModel.parse(input);
	if (!result.ok) throw new Error(result.errors.join("; "));
	return result.model;
}

const rows = [["a", "b", "c"]];

describe("widths in the schema", () => {
	it("defaults every column to automatic", () => {
		const result = parseTableData({ rows });
		expect(result.ok && result.table.widths).toEqual([null, null, null]);
	});

	it("pads a short list and rounds values", () => {
		const result = parseTableData({ rows, widths: [100.4, null] });
		expect(result.ok && result.table.widths).toEqual([100, null, null]);
	});

	it("rejects more widths than columns", () => {
		expect(errors(parseTableData({ rows, widths: [50, 50, 50, 50] }))).toEqual([
			"`widths` has 4 entries but the table has only 3 columns.",
		]);
	});

	it.each([[10], [6000], ["100px"], [Number.NaN], [true]])("rejects width %j", (width) => {
		expect(errors(parseTableData({ rows, widths: [width] }))[0]).toMatch(/^widths\[0\] must be a number/);
	});

	it("rejects a non-list", () => {
		expect(errors(parseTableData({ rows, widths: 100 }))).toEqual(["`widths` must be a list of column widths."]);
	});
});

describe("widths in the model", () => {
	it("reads and writes widths", () => {
		const m = model({ rows, widths: [100] });
		expect(m.columnWidths).toEqual([100, null, null]);
		expect(m.hasColumnWidths).toBe(true);
		m.setColumnWidth(2, 80.6);
		expect(m.getColumnWidth(2)).toBe(81);
		m.setColumnWidth(0, null);
		expect(m.getColumnWidth(0)).toBeNull();
	});

	it("clamps widths to the allowed range", () => {
		const m = model({ rows });
		m.setColumnWidth(0, 1);
		m.setColumnWidth(1, 99999);
		expect(m.columnWidths).toEqual([20, 5000, null]);
	});

	it("rejects bad columns and non-finite widths", () => {
		const m = model({ rows });
		expect(() => m.setColumnWidth(3, 100)).toThrow(RangeError);
		expect(() => m.getColumnWidth(-1)).toThrow(RangeError);
		expect(() => m.setColumnWidth(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
	});

	it("resets all widths", () => {
		const m = model({ rows, widths: [100, 200, 300] });
		m.resetColumnWidths();
		expect(m.hasColumnWidths).toBe(false);
		expect(m.toData().widths).toBeUndefined();
	});

	it("keeps widths aligned with columns on insert and delete", () => {
		const m = model({ rows, widths: [100, 200, 300] });
		m.insertColumns(1, 2);
		expect(m.columnWidths).toEqual([100, null, null, 200, 300]);
		m.deleteColumns(0, 2);
		expect(m.columnWidths).toEqual([null, 200, 300]);
	});

	it("is unaffected by row changes", () => {
		const m = model({ rows, widths: [100] });
		m.insertRows(0);
		m.deleteRows(0);
		expect(m.columnWidths).toEqual([100, null, null]);
	});

	it("is copied by clone", () => {
		const m = model({ rows, widths: [100] });
		const copy = m.clone();
		copy.setColumnWidth(0, 50);
		expect(m.getColumnWidth(0)).toBe(100);
	});

	it("serializes without trailing automatic columns", () => {
		expect(model({ rows, widths: [null, 150] }).toData().widths).toEqual([null, 150]);
		expect(model({ rows }).toData().widths).toBeUndefined();
	});

	it("round-trips through YAML", () => {
		const m = model({ rows, widths: [120, null, 80] });
		const text = serializeTable(m.toData());
		expect(text).toContain("widths: [120, null, 80]");
		expect(model(load(text)).columnWidths).toEqual([120, null, 80]);
	});
});
