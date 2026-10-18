// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { isValidTableSize } from "../../src/model/schema";
import {
	buildMaxHeightPicker,
	buildMaxWidthPicker,
	HEIGHT_PRESETS,
	WIDTH_PRESETS,
} from "../../src/editor/sizePicker";

describe("table size pickers", () => {
	it("only offer valid presets", () => {
		for (const preset of [...HEIGHT_PRESETS, ...WIDTH_PRESETS]) expect(isValidTableSize(preset.value)).toBe(true);
	});

	it("pick a preset, a custom size, or automatic", () => {
		const container = document.createElement("div");
		const onPick = vi.fn();
		buildMaxHeightPicker(container, { current: 400, resetLabel: "Automatic", onPick });
		const button = (text: string) =>
			Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.startsWith(text))!;
		expect(button("Medium").classList.contains("is-active")).toBe(true);
		button("Large").click();
		expect(onPick).toHaveBeenLastCalledWith(600);
		button("Automatic").click();
		expect(onPick).toHaveBeenLastCalledWith(null);
		const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
		input.value = "20";
		button("Apply").click();
		expect(input.classList.contains("is-invalid")).toBe(true);
		input.value = "450";
		button("Apply").click();
		expect(onPick).toHaveBeenLastCalledWith(450);
	});

	it("shows width presets in pixels", () => {
		const container = document.createElement("div");
		buildMaxWidthPicker(container, { current: null, resetLabel: "Automatic", onPick: vi.fn() });
		const labels = Array.from(container.querySelectorAll(".dream-table-max-width-preset"), (b) => b.textContent);
		expect(labels).toEqual(["Small · 400px", "Medium · 600px", "Large · 800px", "Extra large · 1000px"]);
	});
});
