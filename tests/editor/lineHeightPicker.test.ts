// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { isValidLineHeight } from "../../src/model/schema";
import { buildLineHeightPicker, LINE_HEIGHT_PRESETS } from "../../src/editor/paddingPicker";

function setup(current: number | null = null) {
	const container = document.createElement("div");
	const onPick = vi.fn();
	buildLineHeightPicker(container, { current, resetLabel: "Use table line height", onPick });
	const button = (text: string) =>
		Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.startsWith(text))!;
	const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
	return { container, onPick, button, input };
}

describe("buildLineHeightPicker", () => {
	it("only offers valid presets", () => {
		for (const preset of LINE_HEIGHT_PRESETS) expect(isValidLineHeight(preset.value)).toBe(true);
	});

	it("shows presets without a unit", () => {
		const { container } = setup();
		const labels = Array.from(container.querySelectorAll(".dream-table-line-height-preset"), (b) => b.textContent);
		expect(labels).toEqual(["Tight · 1", "Snug · 1.25", "Normal · 1.5", "Relaxed · 1.75", "Loose · 2"]);
	});

	it("picks a preset and marks the current one", () => {
		const { button, onPick } = setup(1.25);
		expect(button("Snug").classList.contains("is-active")).toBe(true);
		button("Loose").click();
		expect(onPick).toHaveBeenCalledWith(2);
	});

	it("accepts decimal custom values and rejects out-of-range ones", () => {
		const { button, input, onPick } = setup();
		expect(input.step).toBe("0.05");
		input.value = "1.35";
		button("Apply").click();
		expect(onPick).toHaveBeenLastCalledWith(1.35);
		input.value = "9";
		button("Apply").click();
		expect(onPick).toHaveBeenCalledTimes(1);
		expect(input.classList.contains("is-invalid")).toBe(true);
	});

	it("resets to null", () => {
		const { button, onPick } = setup(2);
		button("Use table line height").click();
		expect(onPick).toHaveBeenCalledWith(null);
	});
});
