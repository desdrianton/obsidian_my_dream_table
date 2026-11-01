export interface Swatch {
	label: string;
	value: string;
}

const THEME_COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;

const capitalize = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Soft theme-aware fills that keep text readable in light and dark mode. */
export const BACKGROUND_SWATCHES: readonly Swatch[] = THEME_COLORS.map((name) => ({
	label: capitalize(name),
	value: `rgba(var(--color-${name}-rgb), 0.2)`,
}));

export const TEXT_SWATCHES: readonly Swatch[] = THEME_COLORS.map((name) => ({
	label: capitalize(name),
	value: `var(--color-${name})`,
}));

export interface ColorPickerOptions {
	swatches: readonly Swatch[];
	/** Currently applied color, highlighted in the grid. */
	current?: string;
	/** Called with the chosen color, or null for "no color". */
	onPick: (color: string | null) => void;
}

/** Builds the swatch grid, a "None" button, and a custom color input. */
export function buildColorPicker(container: HTMLElement, options: ColorPickerOptions): void {
	const root = container.createDiv({ cls: "dream-table-color-picker" });

	const grid = root.createDiv({ cls: "dream-table-swatches" });
	for (const swatch of options.swatches) {
		const button = grid.createEl("button", {
			cls: "dream-table-swatch",
			type: "button",
			title: swatch.label,
			attr: { "aria-label": swatch.label },
		});
		button.style.background = swatch.value;
		if (swatch.value === options.current) button.classList.add("is-active");
		button.addEventListener("click", () => options.onPick(swatch.value));
	}

	const footer = root.createDiv({ cls: "dream-table-color-footer" });

	const none = footer.createEl("button", { type: "button", text: "None" });
	none.addEventListener("click", () => options.onPick(null));

	const custom = footer.createEl("label", { cls: "dream-table-custom-color", text: "Custom: " });
	const input = custom.createEl("input", { type: "color" });
	if (options.current && /^#[0-9a-f]{6}$/i.test(options.current)) input.value = options.current;
	input.addEventListener("change", () => options.onPick(input.value));
}
