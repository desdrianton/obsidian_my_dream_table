import type { TableModel } from "../model/TableModel";
import { BACKGROUND_SWATCHES, type Swatch } from "./colorPicker";

/** A ready-made look for the whole table, in one pastel color. */
export interface TablePreset {
	id: "header-row" | "header-column" | "striped-rows";
	title: string;
	apply: (model: TableModel, color: string) => void;
}

const lastRow = (model: TableModel) => model.rowCount - 1;
const lastCol = (model: TableModel) => model.colCount - 1;

export const TABLE_PRESETS: readonly TablePreset[] = [
	{
		id: "header-row",
		title: "Header row",
		// The top row becomes the header, if there is none yet.
		apply: (model, color) => {
			if (model.rowCount === 0 || model.colCount === 0) return;
			if (model.headerRows === 0) model.setHeaderRows(1);
			model.applyStyle({ top: 0, left: 0, bottom: model.headerRows - 1, right: lastCol(model) }, {
				bg: color,
				bold: true,
			});
		},
	},
	{
		id: "header-column",
		title: "Header column",
		apply: (model, color) => {
			if (model.rowCount === 0 || model.colCount === 0) return;
			model.applyStyle({ top: 0, left: 0, bottom: lastRow(model), right: 0 }, { bg: color, bold: true });
		},
	},
	{
		id: "striped-rows",
		title: "Striped rows",
		// Every second row below the header gets the color, the others none.
		apply: (model, color) => {
			if (model.colCount === 0) return;
			for (let row = model.headerRows; row < model.rowCount; row++) {
				const striped = (row - model.headerRows) % 2 === 1;
				model.applyStyle({ top: row, left: 0, bottom: row, right: lastCol(model) }, {
					bg: striped ? color : null,
				});
			}
		},
	},
];

export interface PresetPickerOptions {
	/** Colors to offer for each preset; pastel fills by default. */
	swatches?: readonly Swatch[];
	/** Called with the chosen preset and color. */
	onPick: (preset: TablePreset, color: string) => void;
}

/**
 * Builds one row of color swatches per preset, plus a custom color input;
 * a click (or a picked custom color) applies that preset.
 */
export function buildPresetPicker(container: HTMLElement, options: PresetPickerOptions): void {
	const swatches = options.swatches ?? BACKGROUND_SWATCHES;
	const root = container.createDiv({ cls: "dream-table-preset-picker" });

	for (const preset of TABLE_PRESETS) {
		const section = root.createDiv({ cls: "dream-table-preset" });
		section.createDiv({ cls: "dream-table-preset-title", text: preset.title });

		const grid = section.createDiv({ cls: "dream-table-swatches" });
		for (const swatch of swatches) {
			const label = `${preset.title}: ${swatch.label}`;
			const button = grid.createEl("button", {
				cls: "dream-table-swatch",
				type: "button",
				title: label,
				attr: { "aria-label": label },
			});
			button.style.background = swatch.value;
			button.addEventListener("click", () => options.onPick(preset, swatch.value));
		}

		const custom = section.createEl("label", {
			cls: "dream-table-custom-color dream-table-preset-custom",
			text: "Custom: ",
		});
		const input = custom.createEl("input", {
			type: "color",
			attr: { "aria-label": `${preset.title}: custom color` },
		});
		input.addEventListener("change", () => options.onPick(preset, input.value));
	}
}
