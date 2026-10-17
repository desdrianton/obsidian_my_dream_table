// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { isValidPadding } from "../../src/model/schema";
import { buildPaddingPicker, PADDING_PRESETS } from "../../src/editor/paddingPicker";

function setup(current: number | null = null) {
	const container = document.createElement("div");
	const onPick = vi.fn();
	buildPaddingPicker(container, { current, resetLabel: "Use table padding", onPick });
	const buttons = () => Array.from(container.querySelectorAll("button"));
	const button = (text: string) => buttons().find((b) => b.textContent?.startsWith(text))!;
	const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
	return { container, onPick, button, input };
}

describe("buildPaddingPicker", () => {
	it("only offers valid presets", () => {
		for (const preset of PADDING_PRESETS) expect(isValidPadding(preset.value)).toBe(true);
	});

	it("shows each preset with its size", () => {
		const { container } = setup();
		const labels = Array.from(container.querySelectorAll(".dream-table-padding-preset"), (b) => b.textContent);
		expect(labels).toEqual(["None · 0px", "Compact · 4px", "Normal · 8px", "Relaxed · 12px", "Spacious · 20px"]);
	});

	it("picks a preset", () => {
		const { button, onPick } = setup();
		button("Relaxed").click();
		expect(onPick).toHaveBeenCalledWith(12);
	});

	it("picks null from the reset button", () => {
		const { button, onPick } = setup(8);
		button("Use table padding").click();
		expect(onPick).toHaveBeenCalledWith(null);
	});

	it("marks the current preset, or the reset button when nothing is set", () => {
		const set = setup(4);
		expect(set.button("Compact").classList.contains("is-active")).toBe(true);
		expect(set.input.value).toBe("4");
		const unset = setup(null);
		expect(unset.button("Use table padding").classList.contains("is-active")).toBe(true);
		expect(unset.input.value).toBe("");
	});

	it("applies a custom value with the button or Enter", () => {
		const { button, input, onPick } = setup();
		input.value = "6";
		button("Apply").click();
		expect(onPick).toHaveBeenLastCalledWith(6);
		input.value = "30";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
		expect(onPick).toHaveBeenLastCalledWith(30);
	});

	it.each(["", "-2", "2.5", "500", "abc"])("rejects custom value %j", (value) => {
		const { button, input, onPick } = setup();
		input.value = value;
		button("Apply").click();
		expect(onPick).not.toHaveBeenCalled();
		expect(input.classList.contains("is-invalid")).toBe(true);
	});
});
