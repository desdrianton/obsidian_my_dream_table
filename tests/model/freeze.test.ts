import { describe, expect, it } from "vitest";
import { parseTableData } from "../../src/model/schema";
import { serializeTable } from "../../src/model/serialize";
import { TableModel } from "../../src/model/TableModel";

function parse(input: Record<string, unknown>): TableModel {
	const result = TableModel.parse(input);
	if (!result.ok) throw new Error(result.errors.join("; "));
	return result.model;
}

function errors(input: unknown): string[] {
	const result = parseTableData(input);
	return result.ok ? [] : result.errors;
}

const rows = [
	["a", "b", "c"],
	["d", "e", "f"],
	["g", "h", "i"],
];

describe("parsing freezeRows and freezeCols", () => {
	it("defaults to nothing frozen", () => {
		const model = parse({ rows });
		expect(model.freezeRows).toBe(0);
		expect(model.freezeCols).toBe(0);
		expect(model.toData()).not.toHaveProperty("freezeRows");
		expect(model.toData()).not.toHaveProperty("freezeCols");
	});

	it("round-trips through toData and serializeTable", () => {
		const model = parse({ rows, freezeRows: 1, freezeCols: 2 });
		expect(model.toData()).toMatchObject({ freezeRows: 1, freezeCols: 2 });
		const text = serializeTable(model.toData());
		expect(text).toContain("freezeRows: 1\n");
		expect(text).toContain("freezeCols: 2\n");
	});

	it("rejects bad values", () => {
		expect(errors({ rows, freezeRows: -1 })).toEqual(["`freezeRows` must be the number of rows to freeze, e.g. 1."]);
		expect(errors({ rows, freezeCols: 1.5 })).toEqual(["`freezeCols` must be the number of columns to freeze, e.g. 1."]);
		expect(errors({ rows, freezeRows: 4 })).toEqual(["`freezeRows` is 4 but the table has only 3 rows."]);
		expect(errors({ rows, freezeCols: 4 })).toEqual(["`freezeCols` is 4 but the table has only 3 columns."]);
	});
});

describe("frozen rows and columns when editing", () => {
	it("can be set and cleared", () => {
		const model = parse({ rows });
		model.freezeRows = 2;
		model.freezeCols = 3;
		expect(model.clone().freezeRows).toBe(2);
		expect(model.clone().freezeCols).toBe(3);
		model.freezeRows = 0;
		expect(model.toData()).not.toHaveProperty("freezeRows");
		expect(() => (model.freezeRows = 4)).toThrow(RangeError);
		expect(() => (model.freezeCols = -1)).toThrow(RangeError);
	});

	it("grow when rows or columns are inserted inside them", () => {
		const model = parse({ rows, freezeRows: 1, freezeCols: 1 });
		model.insertRows(0);
		model.insertColumns(0);
		expect([model.freezeRows, model.freezeCols]).toEqual([2, 2]);
		model.insertRows(2);
		model.insertColumns(2);
		expect([model.freezeRows, model.freezeCols]).toEqual([2, 2]);
	});

	it("shrink when frozen rows or columns are deleted", () => {
		const model = parse({ rows, freezeRows: 2, freezeCols: 2 });
		model.deleteRows(1, 2);
		model.deleteColumns(0);
		expect([model.freezeRows, model.freezeCols]).toEqual([1, 1]);
		model.deleteRows(0);
		expect(model.freezeRows).toBe(0);
	});
});
