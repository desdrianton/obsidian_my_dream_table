import { isValidTableSize } from "../model/schema";
import { MAX_TABLE_SIZE, MIN_TABLE_SIZE } from "../model/types";
import { buildValuePicker, type ValuePreset } from "./valuePicker";

export const HEIGHT_PRESETS: readonly ValuePreset[] = [
	{ label: "Small", value: 300 },
	{ label: "Medium", value: 400 },
	{ label: "Large", value: 600 },
	{ label: "Extra large", value: 800 },
];

export const WIDTH_PRESETS: readonly ValuePreset[] = [
	{ label: "Small", value: 400 },
	{ label: "Medium", value: 600 },
	{ label: "Large", value: 800 },
	{ label: "Extra large", value: 1000 },
];

export interface SizePickerOptions {
	/** Value currently set, if any. */
	current: number | null;
	/** Label of the button that removes the setting. */
	resetLabel: string;
	/** Called with the chosen size, or null to remove the setting. */
	onPick: (value: number | null) => void;
}

/** Maximum table height in whole pixels. */
export function buildMaxHeightPicker(container: HTMLElement, options: SizePickerOptions): void {
	buildSizePicker(container, options, HEIGHT_PRESETS, "dream-table-max-height");
}

/** Maximum table width in whole pixels. */
export function buildMaxWidthPicker(container: HTMLElement, options: SizePickerOptions): void {
	buildSizePicker(container, options, WIDTH_PRESETS, "dream-table-max-width");
}

function buildSizePicker(
	container: HTMLElement,
	options: SizePickerOptions,
	presets: readonly ValuePreset[],
	classPrefix: string,
): void {
	buildValuePicker(container, {
		...options,
		presets,
		unit: "px",
		min: MIN_TABLE_SIZE,
		max: MAX_TABLE_SIZE,
		step: 10,
		isValid: isValidTableSize,
		classPrefix,
	});
}
