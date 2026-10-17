import { isValidBorderWidth } from "../model/schema";
import { BORDER_STYLES, MAX_BORDER_WIDTH, MIN_BORDER_WIDTH, type BorderStyle } from "../model/types";
import type { Swatch } from "./colorPicker";

/** A border choice where null means "not set here" (inherit from the next level). */
export interface BorderChoice {
	color: string | null;
	width: number | null;
	style: BorderStyle | null;
}

export const BORDER_WIDTH_PRESETS: readonly number[] = [1, 2, 3, 4, 6];

const THEME_COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;

export const BORDER_SWATCHES: readonly Swatch[] = [
	{ label: "Text", value: "var(--text-normal)" },
	{ label: "Muted", value: "var(--text-muted)" },
	{ label: "Faint", value: "var(--text-faint)" },
	...THEME_COLORS.map((name) => ({ label: name[0]!.toUpperCase() + name.slice(1), value: `var(--color-${name})` })),
];

export interface BorderPickerOptions {
	current: BorderChoice;
	/** Label of the button that removes every setting at this level. */
	resetLabel: string;
	onApply: (choice: BorderChoice) => void;
}

/**
 * Builds a border editor: style, width and color rows (each with a
 * "Default" choice meaning inherit), a live preview, and Reset/Apply.
 */
export function buildBorderPicker(container: HTMLElement, options: BorderPickerOptions): void {
	const doc = container.ownerDocument;
	const choice: BorderChoice = { ...options.current };
	const root = doc.createElement("div");
	root.className = "dream-table-border-picker";

	const refreshers: (() => void)[] = [];
	const refresh = () => refreshers.forEach((fn) => fn());

	/** A labelled row of toggle buttons bound to one property of `choice`. */
	function optionRow<K extends keyof BorderChoice>(
		title: string,
		key: K,
		items: { label: string; value: BorderChoice[K]; swatch?: string }[],
	): HTMLElement {
		const row = doc.createElement("div");
		row.className = `dream-table-border-row dream-table-border-${key}`;
		const heading = doc.createElement("div");
		heading.className = "dream-table-border-heading";
		heading.textContent = title;
		row.appendChild(heading);

		const buttons = doc.createElement("div");
		buttons.className = "dream-table-border-options";
		for (const item of items) {
			const button = doc.createElement("button");
			button.type = "button";
			button.dataset.value = String(item.value);
			if (item.swatch) {
				button.className = "dream-table-swatch";
				button.style.background = item.swatch;
				button.title = item.label;
				button.setAttribute("aria-label", item.label);
			} else {
				button.textContent = item.label;
			}
			button.addEventListener("click", () => {
				choice[key] = item.value;
				refresh();
			});
			refreshers.push(() => button.classList.toggle("is-active", choice[key] === item.value));
			buttons.appendChild(button);
		}
		row.appendChild(buttons);
		return row;
	}

	root.appendChild(
		optionRow("Style", "style", [
			{ label: "Default", value: null },
			...BORDER_STYLES.map((s) => ({ label: s[0]!.toUpperCase() + s.slice(1), value: s })),
		]),
	);

	const widthRow = optionRow("Width", "width", [
		{ label: "Default", value: null },
		...BORDER_WIDTH_PRESETS.map((w) => ({ label: `${w}px`, value: w })),
	]);
	const widthInput = doc.createElement("input");
	widthInput.type = "number";
	widthInput.min = String(MIN_BORDER_WIDTH);
	widthInput.max = String(MAX_BORDER_WIDTH);
	widthInput.step = "1";
	widthInput.placeholder = "px";
	widthInput.className = "dream-table-border-width-input";
	widthInput.setAttribute("aria-label", "Custom border width in px");
	widthInput.addEventListener("input", () => {
		const value = widthInput.value.trim() === "" ? Number.NaN : Number(widthInput.value);
		const valid = isValidBorderWidth(value);
		widthInput.classList.toggle("is-invalid", !valid);
		if (valid) {
			choice.width = value;
			refresh();
		}
	});
	refreshers.push(() => {
		if (doc.activeElement !== widthInput) widthInput.value = choice.width === null ? "" : String(choice.width);
	});
	widthRow.querySelector(".dream-table-border-options")!.appendChild(widthInput);
	root.appendChild(widthRow);

	const colorRow = optionRow("Color", "color", [
		{ label: "Default", value: null },
		...BORDER_SWATCHES.map((s) => ({ label: s.label, value: s.value, swatch: s.value })),
	]);
	const colorInput = doc.createElement("input");
	colorInput.type = "color";
	colorInput.title = "Custom color";
	colorInput.setAttribute("aria-label", "Custom border color");
	colorInput.addEventListener("input", () => {
		choice.color = colorInput.value;
		refresh();
	});
	refreshers.push(() => {
		const custom = choice.color !== null && /^#[0-9a-f]{6}$/i.test(choice.color);
		colorInput.classList.toggle("is-active", custom);
		if (custom) colorInput.value = choice.color!;
	});
	colorRow.querySelector(".dream-table-border-options")!.appendChild(colorInput);
	root.appendChild(colorRow);

	const preview = doc.createElement("div");
	preview.className = "dream-table-border-preview";
	preview.textContent = "Preview";
	refreshers.push(() => {
		preview.style.borderWidth = choice.width === null ? "" : `${choice.width}px`;
		preview.style.borderStyle = choice.style ?? "";
		preview.style.borderColor = choice.color ?? "";
	});
	root.appendChild(preview);

	const footer = doc.createElement("div");
	footer.className = "dream-table-border-footer";
	const reset = doc.createElement("button");
	reset.type = "button";
	reset.textContent = options.resetLabel;
	reset.addEventListener("click", () => options.onApply({ color: null, width: null, style: null }));
	const apply = doc.createElement("button");
	apply.type = "button";
	apply.className = "mod-cta";
	apply.textContent = "Apply";
	apply.addEventListener("click", () => options.onApply({ ...choice }));
	footer.append(reset, apply);
	root.appendChild(footer);

	refresh();
	container.appendChild(root);
}
