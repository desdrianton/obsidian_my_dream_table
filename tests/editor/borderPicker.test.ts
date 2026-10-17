// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { isValidColor } from "../../src/model/schema";
import { BORDER_SWATCHES, buildBorderPicker, type BorderChoice } from "../../src/editor/borderPicker";

const EMPTY: BorderChoice = { color: null, width: null, style: null };

function setup(current: BorderChoice = EMPTY) {
	const container = document.createElement("div");
	const onApply = vi.fn();
	buildBorderPicker(container, { current, resetLabel: "Use table border", onApply });
	const row = (key: string) => container.querySelector<HTMLElement>(`.dream-table-border-${key}`)!;
	const option = (key: string, value: string) =>
		row(key).querySelector<HTMLButtonElement>(`button[data-value="${value}"]`)!;
	const button = (text: string) =>
		Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text)!;
	const widthInput = container.querySelector<HTMLInputElement>(".dream-table-border-width-input")!;
	const colorInput = container.querySelector<HTMLInputElement>('input[type="color"]')!;
	const preview = container.querySelector<HTMLElement>(".dream-table-border-preview")!;
	return { container, onApply, row, option, button, widthInput, colorInput, preview };
}

describe("buildBorderPicker", () => {
	it("only offers valid colors", () => {
		for (const swatch of BORDER_SWATCHES) expect(isValidColor(swatch.value)).toBe(true);
	});

	it("starts from the current settings", () => {
		const { option, widthInput, preview } = setup({ color: "var(--color-red)", width: 2, style: "dashed" });
		expect(option("style", "dashed").classList.contains("is-active")).toBe(true);
		expect(option("width", "2").classList.contains("is-active")).toBe(true);
		expect(option("color", "var(--color-red)").classList.contains("is-active")).toBe(true);
		expect(widthInput.value).toBe("2");
		expect(preview.style.borderStyle).toBe("dashed");
		expect(preview.style.borderWidth).toBe("2px");
	});

	it("marks Default when nothing is set", () => {
		const { option } = setup();
		for (const key of ["style", "width", "color"]) {
			expect(option(key, "null").classList.contains("is-active")).toBe(true);
		}
	});

	it("applies the combined choice", () => {
		const { option, button, onApply } = setup();
		option("style", "dotted").click();
		option("width", "3").click();
		option("color", "var(--text-muted)").click();
		expect(onApply).not.toHaveBeenCalled();
		button("Apply").click();
		expect(onApply).toHaveBeenCalledWith({ color: "var(--text-muted)", width: 3, style: "dotted" });
	});

	it("can switch a property back to Default", () => {
		const { option, button, onApply } = setup({ color: "red", width: 2, style: "solid" });
		option("width", "null").click();
		button("Apply").click();
		expect(onApply).toHaveBeenCalledWith({ color: "red", width: null, style: "solid" });
	});

	it("takes a custom width and color", () => {
		const { widthInput, colorInput, button, onApply, option } = setup();
		widthInput.value = "9";
		widthInput.dispatchEvent(new Event("input"));
		colorInput.value = "#123abc";
		colorInput.dispatchEvent(new Event("input"));
		expect(option("width", "null").classList.contains("is-active")).toBe(false);
		expect(colorInput.classList.contains("is-active")).toBe(true);
		button("Apply").click();
		expect(onApply).toHaveBeenCalledWith({ color: "#123abc", width: 9, style: null });
	});

	it("ignores an invalid custom width", () => {
		const { widthInput, button, onApply } = setup();
		widthInput.value = "50";
		widthInput.dispatchEvent(new Event("input"));
		expect(widthInput.classList.contains("is-invalid")).toBe(true);
		button("Apply").click();
		expect(onApply).toHaveBeenCalledWith(EMPTY);
	});

	it("resets everything", () => {
		const { button, onApply } = setup({ color: "red", width: 2, style: "solid" });
		button("Use table border").click();
		expect(onApply).toHaveBeenCalledWith(EMPTY);
	});
});
