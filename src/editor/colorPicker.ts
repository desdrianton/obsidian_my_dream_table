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
	const doc = container.ownerDocument;
	const root = doc.createElement("div");
	root.className = "dream-table-color-picker";

	const grid = doc.createElement("div");
	grid.className = "dream-table-swatches";
	for (const swatch of options.swatches) {
		const button = doc.createElement("button");
		button.className = "dream-table-swatch";
		button.type = "button";
		button.title = swatch.label;
		button.setAttribute("aria-label", swatch.label);
		button.style.background = swatch.value;
		if (swatch.value === options.current) button.classList.add("is-active");
		button.addEventListener("click", () => options.onPick(swatch.value));
		grid.appendChild(button);
	}
	root.appendChild(grid);

	const footer = doc.createElement("div");
	footer.className = "dream-table-color-footer";

	const none = doc.createElement("button");
	none.type = "button";
	none.textContent = "None";
	none.addEventListener("click", () => options.onPick(null));
	footer.appendChild(none);

	const custom = doc.createElement("label");
	custom.className = "dream-table-custom-color";
	custom.textContent = "Custom: ";
	const input = doc.createElement("input");
	input.type = "color";
	if (options.current && /^#[0-9a-f]{6}$/i.test(options.current)) input.value = options.current;
	input.addEventListener("change", () => options.onPick(input.value));
	custom.appendChild(input);
	footer.appendChild(custom);

	root.appendChild(footer);
	container.appendChild(root);
}
