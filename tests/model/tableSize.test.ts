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

const rows = [["a", "b"]];

describe("maxHeight and maxWidth", () => {
	it("default to no limit", () => {
		const model = parse({ rows });
		expect(model.maxHeight).toBeNull();
		expect(model.maxWidth).toBeNull();
		expect(model.toData()).not.toHaveProperty("maxHeight");
		expect(model.toData()).not.toHaveProperty("maxWidth");
	});

	it("round-trip through toData and serializeTable", () => {
		const model = parse({ rows, maxHeight: 400, maxWidth: 600 });
		expect(model.clone().toData()).toMatchObject({ maxHeight: 400, maxWidth: 600 });
		const text = serializeTable(model.toData());
		expect(text).toContain("maxHeight: 400\n");
		expect(text).toContain("maxWidth: 600\n");
	});

	it("reject sizes that are not whole pixels in range", () => {
		const message = (key: string) => `\`${key}\` must be a whole number of pixels from 50 to 10000.`;
		expect(errors({ rows, maxHeight: 49 })).toEqual([message("maxHeight")]);
		expect(errors({ rows, maxWidth: 10001 })).toEqual([message("maxWidth")]);
		expect(errors({ rows, maxHeight: "400px" })).toEqual([message("maxHeight")]);
		expect(errors({ rows, maxWidth: 300.5 })).toEqual([message("maxWidth")]);
	});

	it("can be set and cleared", () => {
		const model = parse({ rows });
		model.maxHeight = 300;
		model.maxWidth = 800;
		expect(model.toData()).toMatchObject({ maxHeight: 300, maxWidth: 800 });
		model.maxHeight = null;
		model.maxWidth = null;
		expect(model.toData()).not.toHaveProperty("maxHeight");
		expect(() => (model.maxHeight = 10)).toThrow(RangeError);
		expect(() => (model.maxWidth = 1.5)).toThrow(RangeError);
	});
});
