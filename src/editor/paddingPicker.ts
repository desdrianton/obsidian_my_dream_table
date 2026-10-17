import { isValidPadding } from "../model/schema";
import { MAX_PADDING, MIN_PADDING } from "../model/types";

export interface PaddingPreset {
	label: string;
	value: number;
}

export const PADDING_PRESETS: readonly PaddingPreset[] = [
	{ label: "None", value: 0 },
	{ label: "Compact", value: 4 },
	{ label: "Normal", value: 8 },
	{ label: "Relaxed", value: 12 },
	{ label: "Spacious", value: 20 },
];

export interface PaddingPickerOptions {
	/** Padding currently set at this level, if any. */
	current: number | null;
	/** Label of the button that removes the setting, e.g. "Use table padding". */
	resetLabel: string;
	/** Called with the chosen padding in px, or null to remove the setting. */
	onPick: (padding: number | null) => void;
}

/** Builds preset buttons, a reset button, and a custom px input. */
export function buildPaddingPicker(container: HTMLElement, options: PaddingPickerOptions): void {
	const doc = container.ownerDocument;
	const root = doc.createElement("div");
	root.className = "dream-table-padding-picker";

	const presets = doc.createElement("div");
	presets.className = "dream-table-padding-presets";
	for (const preset of PADDING_PRESETS) {
		const button = doc.createElement("button");
		button.type = "button";
		button.className = "dream-table-padding-preset";
		button.textContent = `${preset.label} · ${preset.value}px`;
		if (preset.value === options.current) button.classList.add("is-active", "mod-cta");
		button.addEventListener("click", () => options.onPick(preset.value));
		presets.appendChild(button);
	}
	root.appendChild(presets);

	const footer = doc.createElement("div");
	footer.className = "dream-table-padding-footer";

	const reset = doc.createElement("button");
	reset.type = "button";
	reset.textContent = options.resetLabel;
	if (options.current === null) reset.classList.add("is-active");
	reset.addEventListener("click", () => options.onPick(null));
	footer.appendChild(reset);

	const custom = doc.createElement("label");
	custom.className = "dream-table-padding-custom";
	custom.append("Custom: ");
	const input = doc.createElement("input");
	input.type = "number";
	input.min = String(MIN_PADDING);
	input.max = String(MAX_PADDING);
	input.step = "1";
	input.placeholder = "px";
	if (options.current !== null) input.value = String(options.current);
	custom.appendChild(input);
	custom.append(" px ");

	const apply = doc.createElement("button");
	apply.type = "button";
	apply.textContent = "Apply";
	custom.appendChild(apply);
	footer.appendChild(custom);

	const submit = () => {
		const value = input.value.trim() === "" ? Number.NaN : Number(input.value);
		const valid = isValidPadding(value);
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
