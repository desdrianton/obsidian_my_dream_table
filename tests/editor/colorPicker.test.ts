// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { isValidColor } from "../../src/model/schema";
import { BACKGROUND_SWATCHES, buildColorPicker, TEXT_SWATCHES } from "../../src/editor/colorPicker";

describe("swatches", () => {
	it("only contain colors the schema accepts", () => {
		for (const swatch of [...BACKGROUND_SWATCHES, ...TEXT_SWATCHES]) {
			expect(isValidColor(swatch.value), swatch.value).toBe(true);
		}
	});
});

describe("buildColorPicker", () => {
	function setup(current?: string) {
		const container = document.createElement("div");
		const onPick = vi.fn();
		buildColorPicker(container, { swatches: TEXT_SWATCHES, current, onPick });
		return { container, onPick };
	}

	it("renders one button per swatch", () => {
		const { container } = setup();
		expect(container.querySelectorAll(".dream-table-swatch")).toHaveLength(TEXT_SWATCHES.length);
	});

	it("picks a swatch on click", () => {
		const { container, onPick } = setup();
		const buttons = container.querySelectorAll<HTMLButtonElement>(".dream-table-swatch");
		buttons[2]!.click();
		expect(onPick).toHaveBeenCalledWith(TEXT_SWATCHES[2]!.value);
	});

	it("marks the current color", () => {
		const { container } = setup(TEXT_SWATCHES[1]!.value);
		const active = container.querySelectorAll(".dream-table-swatch.is-active");
		expect(active).toHaveLength(1);
		expect(active[0]!.getAttribute("aria-label")).toBe(TEXT_SWATCHES[1]!.label);
	});

	it("picks null for None", () => {
		const { container, onPick } = setup();
		const none = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "None")!;
		none.click();
		expect(onPick).toHaveBeenCalledWith(null);
	});

	it("picks a custom color from the color input", () => {
		const { container, onPick } = setup("#123456");
		const input = container.querySelector<HTMLInputElement>('input[type="color"]')!;
		expect(input.value).toBe("#123456");
		input.value = "#abcdef";
		input.dispatchEvent(new Event("change"));
		expect(onPick).toHaveBeenCalledWith("#abcdef");
	});
});
