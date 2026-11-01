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
	const prefix = options.classPrefix;
	const root = container.createDiv({ cls: `dream-table-value-picker ${prefix}-picker` });

	const presets = root.createDiv({ cls: `dream-table-value-presets ${prefix}-presets` });
	for (const preset of options.presets) {
		const button = presets.createEl("button", {
			type: "button",
			cls: `dream-table-value-preset ${prefix}-preset`,
			text: `${preset.label} · ${preset.value}${options.unit}`,
		});
		if (preset.value === options.current) button.classList.add("is-active", "mod-cta");
		button.addEventListener("click", () => options.onPick(preset.value));
	}

	const footer = root.createDiv({ cls: `dream-table-value-footer ${prefix}-footer` });

	const reset = footer.createEl("button", { type: "button", text: options.resetLabel });
	if (options.current === null) reset.classList.add("is-active");
	reset.addEventListener("click", () => options.onPick(null));

	const custom = footer.createEl("label", { cls: `dream-table-value-custom ${prefix}-custom` });
	custom.append("Custom: ");
	const input = custom.createEl("input", {
		type: "number",
		placeholder: options.unit,
		attr: { min: String(options.min), max: String(options.max), step: String(options.step) },
	});
	if (options.current !== null) input.value = String(options.current);
	if (options.unit) custom.append(` ${options.unit} `);

	const apply = custom.createEl("button", { type: "button", text: "Apply" });

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
}
