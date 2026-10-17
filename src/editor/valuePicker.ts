export interface ValuePreset {
	label: string;
	value: number;
}

export interface ValuePickerOptions {
	presets: readonly ValuePreset[];
	/** Value currently set at this level, if any. */
	current: number | null;
	/** Label of the button that removes the setting, e.g. "Use table padding". */
	resetLabel: string;
	/** Unit shown after numbers, e.g. "px" (empty for none). */
	unit: string;
	min: number;
	max: number;
	step: number;
	isValid: (value: number) => boolean;
	/** CSS class prefix, e.g. "dream-table-padding". */
	classPrefix: string;
	/** Called with the chosen value, or null to remove the setting. */
	onPick: (value: number | null) => void;
}

/** Builds preset buttons, a reset button, and a custom number input. */
export function buildValuePicker(container: HTMLElement, options: ValuePickerOptions): void {
	const doc = container.ownerDocument;
	const prefix = options.classPrefix;
	const root = doc.createElement("div");
	root.className = `dream-table-value-picker ${prefix}-picker`;

	const presets = doc.createElement("div");
	presets.className = `dream-table-value-presets ${prefix}-presets`;
	for (const preset of options.presets) {
		const button = doc.createElement("button");
		button.type = "button";
		button.className = `dream-table-value-preset ${prefix}-preset`;
		button.textContent = `${preset.label} · ${preset.value}${options.unit}`;
		if (preset.value === options.current) button.classList.add("is-active", "mod-cta");
		button.addEventListener("click", () => options.onPick(preset.value));
		presets.appendChild(button);
	}
	root.appendChild(presets);

	const footer = doc.createElement("div");
	footer.className = `dream-table-value-footer ${prefix}-footer`;

	const reset = doc.createElement("button");
	reset.type = "button";
	reset.textContent = options.resetLabel;
	if (options.current === null) reset.classList.add("is-active");
	reset.addEventListener("click", () => options.onPick(null));
	footer.appendChild(reset);

	const custom = doc.createElement("label");
	custom.className = `dream-table-value-custom ${prefix}-custom`;
	custom.append("Custom: ");
	const input = doc.createElement("input");
	input.type = "number";
	input.min = String(options.min);
	input.max = String(options.max);
	input.step = String(options.step);
	input.placeholder = options.unit;
	if (options.current !== null) input.value = String(options.current);
	custom.appendChild(input);
	if (options.unit) custom.append(` ${options.unit} `);

	const apply = doc.createElement("button");
	apply.type = "button";
	apply.textContent = "Apply";
	custom.appendChild(apply);
	footer.appendChild(custom);

	const submit = () => {
		const value = input.value.trim() === "" ? Number.NaN : Number(input.value);
		const valid = options.isValid(value);
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
