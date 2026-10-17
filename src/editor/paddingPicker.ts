import { isValidPadding, isValidLineHeight } from "../model/schema";
import { MAX_LINE_HEIGHT, MAX_PADDING, MIN_LINE_HEIGHT, MIN_PADDING } from "../model/types";
import { buildValuePicker, type ValuePreset } from "./valuePicker";

export const PADDING_PRESETS: readonly ValuePreset[] = [
	{ label: "None", value: 0 },
	{ label: "Compact", value: 4 },
	{ label: "Normal", value: 8 },
	{ label: "Relaxed", value: 12 },
	{ label: "Spacious", value: 20 },
];

export const LINE_HEIGHT_PRESETS: readonly ValuePreset[] = [
	{ label: "Tight", value: 1 },
	{ label: "Snug", value: 1.25 },
	{ label: "Normal", value: 1.5 },
	{ label: "Relaxed", value: 1.75 },
	{ label: "Loose", value: 2 },
];

export interface SpacingPickerOptions {
	/** Value currently set at this level, if any. */
	current: number | null;
	/** Label of the button that removes the setting. */
	resetLabel: string;
	/** Called with the chosen value, or null to remove the setting. */
	onPick: (value: number | null) => void;
}

/** Padding in whole pixels. */
export function buildPaddingPicker(container: HTMLElement, options: SpacingPickerOptions): void {
	buildValuePicker(container, {
		...options,
		presets: PADDING_PRESETS,
		unit: "px",
		min: MIN_PADDING,
		max: MAX_PADDING,
		step: 1,
		isValid: isValidPadding,
		classPrefix: "dream-table-padding",
	});
}

/** Line height as a multiple of the font size. */
export function buildLineHeightPicker(container: HTMLElement, options: SpacingPickerOptions): void {
	buildValuePicker(container, {
		...options,
		presets: LINE_HEIGHT_PRESETS,
		unit: "",
		min: MIN_LINE_HEIGHT,
		max: MAX_LINE_HEIGHT,
		step: 0.05,
		isValid: isValidLineHeight,
		classPrefix: "dream-table-line-height",
	});
}
