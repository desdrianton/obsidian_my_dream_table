import { isValidFontFamily, isValidFontSize } from "../model/schema";
import { MAX_FONT_SIZE, MIN_FONT_SIZE } from "../model/types";
import { buildValuePicker, type ValuePreset } from "./valuePicker";

export const FONT_SIZE_PRESETS: readonly ValuePreset[] = [
	{ label: "Tiny", value: 10 },
	{ label: "Small", value: 13 },
	{ label: "Normal", value: 16 },
	{ label: "Large", value: 20 },
	{ label: "Huge", value: 28 },
];

export interface FontFamilyPreset {
	label: string;
	value: string;
}

/** Theme fonts first, so tables follow the user's appearance settings. */
export const FONT_FAMILY_PRESETS: readonly FontFamilyPreset[] = [
	{ label: "Text", value: "var(--font-text)" },
	{ label: "Interface", value: "var(--font-interface)" },
	{ label: "Monospace", value: "var(--font-monospace)" },
	{ label: "Serif", value: "Georgia, serif" },
	{ label: "Sans-serif", value: "Arial, Helvetica, sans-serif" },
	{ label: "Handwriting", value: '"Comic Sans MS", cursive' },
];

export interface FontSizePickerOptions {
	/** Font size (px) currently set at this level, if any. */
	current: number | null;
	/** Label of the button that removes the setting. */
	resetLabel: string;
	/** Called with the chosen size in px, or null to remove the setting. */
	onPick: (fontSize: number | null) => void;
}

/** Font size in whole pixels. */
export function buildFontSizePicker(container: HTMLElement, options: FontSizePickerOptions): void {
	buildValuePicker(container, {
		...options,
		presets: FONT_SIZE_PRESETS,
		unit: "px",
		min: MIN_FONT_SIZE,
		max: MAX_FONT_SIZE,
		step: 1,
		isValid: isValidFontSize,
		classPrefix: "dream-table-font-size",
	});
}

export interface FontFamilyPickerOptions {
	/** Font family currently set at this level, if any. */
	current: string | null;
	/** Label of the button that removes the setting. */
	resetLabel: string;
	/** Called with the chosen font family, or null to remove the setting. */
	onPick: (fontFamily: string | null) => void;
}

/** Builds preset buttons (each shown in its own font), a reset button, and a custom font input. */
export function buildFontFamilyPicker(container: HTMLElement, options: FontFamilyPickerOptions): void {
	const doc = container.ownerDocument;
	const root = doc.createElement("div");
	root.className = "dream-table-value-picker dream-table-font-family-picker";

	const presets = doc.createElement("div");
	presets.className = "dream-table-value-presets dream-table-font-family-presets";
	for (const preset of FONT_FAMILY_PRESETS) {
		const button = doc.createElement("button");
		button.type = "button";
		button.className = "dream-table-value-preset dream-table-font-family-preset";
		button.textContent = preset.label;
		button.title = preset.value;
		button.style.fontFamily = preset.value;
		if (preset.value === options.current) button.classList.add("is-active", "mod-cta");
		button.addEventListener("click", () => options.onPick(preset.value));
		presets.appendChild(button);
	}
	root.appendChild(presets);

	const footer = doc.createElement("div");
	footer.className = "dream-table-value-footer dream-table-font-family-footer";

	const reset = doc.createElement("button");
	reset.type = "button";
	reset.textContent = options.resetLabel;
	if (options.current === null) reset.classList.add("is-active");
	reset.addEventListener("click", () => options.onPick(null));
	footer.appendChild(reset);

	const custom = doc.createElement("label");
	custom.className = "dream-table-value-custom dream-table-font-family-custom";
	custom.append("Custom: ");
	const input = doc.createElement("input");
	input.type = "text";
	input.placeholder = '"Fira Code", monospace';
	input.spellcheck = false;
	if (options.current !== null && !FONT_FAMILY_PRESETS.some((p) => p.value === options.current)) {
		input.value = options.current;
	}
	custom.appendChild(input);
	custom.append(" ");

	const apply = doc.createElement("button");
	apply.type = "button";
	apply.textContent = "Apply";
	custom.appendChild(apply);
	footer.appendChild(custom);

	const submit = () => {
		const value = input.value.trim();
		const valid = isValidFontFamily(value);
		input.classList.toggle("is-invalid", !valid);
		input.setAttribute("aria-invalid", String(!valid));
		if (valid) options.onPick(value);
	};
	apply.addEventListener("click", submit);
	input.addEventListener("keydown", (evt) => {
		if (evt.key === "Enter") {
			evt.preventDefault();
			submit();
		}
	});

	root.appendChild(footer);
	container.appendChild(root);
}
