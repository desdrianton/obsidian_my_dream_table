// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { isValidFontFamily, isValidFontSize } from "../../src/model/schema";
import {
	buildFontFamilyPicker,
	buildFontSizePicker,
	FONT_FAMILY_PRESETS,
	FONT_SIZE_PRESETS,
} from "../../src/editor/fontPicker";

function buttonIn(container: HTMLElement, text: string): HTMLButtonElement {
	return Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.startsWith(text))!;
}

describe("buildFontSizePicker", () => {
	it("only offers valid presets", () => {
		for (const preset of FONT_SIZE_PRESETS) expect(isValidFontSize(preset.value)).toBe(true);
	});

	it("picks a preset, a custom size, or the reset", () => {
		const container = document.createElement("div");
		const onPick = vi.fn();
		buildFontSizePicker(container, { current: 13, resetLabel: "Use table font size", onPick });
		expect(buttonIn(container, "Small").classList.contains("is-active")).toBe(true);
		expect(buttonIn(container, "Small").textContent).toBe("Small · 13px");

		buttonIn(container, "Large").click();
		const input = container.querySelector<HTMLInputElement>('input[type="number"]')!;
		input.value = "3";
		buttonIn(container, "Apply").click();
		expect(input.classList.contains("is-invalid")).toBe(true);
		input.value = "22";
		buttonIn(container, "Apply").click();
		buttonIn(container, "Use table font size").click();
		expect(onPick.mock.calls).toEqual([[20], [22], [null]]);
	});
});

describe("buildFontFamilyPicker", () => {
	function setup(current: string | null = null) {
		const container = document.createElement("div");
		const onPick = vi.fn();
		buildFontFamilyPicker(container, { current, resetLabel: "Use table font", onPick });
		const input = container.querySelector<HTMLInputElement>('input[type="text"]')!;
		return { container, onPick, input };
	}

	it("only offers valid presets", () => {
		for (const preset of FONT_FAMILY_PRESETS) expect(isValidFontFamily(preset.value)).toBe(true);
	});

	it("shows each preset in its own font and marks the current one", () => {
		const { container, input } = setup("var(--font-monospace)");
		const mono = buttonIn(container, "Monospace");
		expect(mono.style.fontFamily).toBe("var(--font-monospace)");
		expect(mono.classList.contains("is-active")).toBe(true);
		expect(input.value).toBe("");
	});

	it("prefills a custom current font", () => {
		expect(setup("Georgia").input.value).toBe("Georgia");
	});

	it("picks a preset, a custom font, or the reset, and refuses invalid input", () => {
		const { container, onPick, input } = setup();
		expect(buttonIn(container, "Use table font").classList.contains("is-active")).toBe(true);
		buttonIn(container, "Serif").click();
		input.value = "Arial; color: red";
		buttonIn(container, "Apply").click();
		expect(input.getAttribute("aria-invalid")).toBe("true");
		input.value = ' "Fira Code", monospace ';
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		buttonIn(container, "Use table font").click();
		expect(onPick.mock.calls).toEqual([["Georgia, serif"], ['"Fira Code", monospace'], [null]]);
	});
});
