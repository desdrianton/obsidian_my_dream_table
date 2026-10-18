// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { BACKGROUND_SWATCHES } from "../../src/editor/colorPicker";
import { buildPresetPicker, TABLE_PRESETS, type TablePreset } from "../../src/editor/presetPicker";
import { TableModel } from "../../src/model/TableModel";

const preset = (id: TablePreset["id"]) => TABLE_PRESETS.find((p) => p.id === id)!;
const color = BACKGROUND_SWATCHES[0]!.value;
const other = BACKGROUND_SWATCHES[1]!.value;

describe("header row preset", () => {
	it("makes the top row a colored, bold header", () => {
		const model = TableModel.create(3, 2);
		preset("header-row").apply(model, color);
		expect(model.headerRows).toBe(1);
		expect(model.getStyle(0, 1)).toMatchObject({ bg: color, bold: true });
		expect(model.getStyle(1, 0).bg).toBeUndefined();
	});

	it("colors every row of an existing header", () => {
		const model = TableModel.create(4, 2);
		model.setHeaderRows(2);
		preset("header-row").apply(model, color);
		expect(model.headerRows).toBe(2);
		expect(model.getStyle(1, 0).bg).toBe(color);
		expect(model.getStyle(2, 0).bg).toBeUndefined();
	});
});

describe("header column preset", () => {
	it("colors and bolds the first column", () => {
		const model = TableModel.create(3, 3);
		preset("header-column").apply(model, color);
		expect(model.getStyle(2, 0)).toMatchObject({ bg: color, bold: true });
		expect(model.getStyle(2, 1).bg).toBeUndefined();
		expect(model.headerRows).toBe(0);
	});
});

describe("striped rows preset", () => {
	it("colors every second row below the header", () => {
		const model = TableModel.create(5, 2);
		model.setHeaderRows(1);
		preset("striped-rows").apply(model, color);
		const bgs = [0, 1, 2, 3, 4].map((r) => model.getStyle(r, 1).bg);
		expect(bgs).toEqual([undefined, undefined, color, undefined, color]);
	});

	it("replaces earlier stripes and body colors", () => {
		const model = TableModel.create(4, 2);
		model.applyStyle({ top: 0, left: 0, bottom: 0, right: 1 }, { bg: other });
		preset("striped-rows").apply(model, color);
		preset("striped-rows").apply(model, other);
		const bgs = [0, 1, 2, 3].map((r) => model.getStyle(r, 0).bg);
		expect(bgs).toEqual([undefined, other, undefined, other]);
	});
});

describe("buildPresetPicker", () => {
	it("applies the preset and color of the clicked swatch", () => {
		const container = document.createElement("div");
		const onPick = vi.fn();
		buildPresetPicker(container, { onPick });
		const sections = container.querySelectorAll(".dream-table-preset");
		expect(sections).toHaveLength(TABLE_PRESETS.length);
		sections[2]!.querySelectorAll<HTMLButtonElement>(".dream-table-swatch")[1]!.click();
		expect(onPick).toHaveBeenCalledWith(TABLE_PRESETS[2], other);
	});

	it("applies a preset with a custom color", () => {
		const container = document.createElement("div");
		const onPick = vi.fn();
		buildPresetPicker(container, { onPick });
		const input = container.querySelectorAll<HTMLInputElement>(".dream-table-preset input[type=color]")[1]!;
		input.value = "#ffccaa";
		input.dispatchEvent(new Event("change"));
		expect(onPick).toHaveBeenCalledWith(TABLE_PRESETS[1], "#ffccaa");
	});
});
