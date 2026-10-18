/** Current version of the serialized table format. */
export const FORMAT_VERSION = 1;

/** Narrowest column width (px) accepted in a table. */
export const MIN_COLUMN_WIDTH = 20;
/** Widest column width (px) accepted in a table. */
export const MAX_COLUMN_WIDTH = 5000;

/** Allowed maximum table height and width (px). */
export const MIN_TABLE_SIZE = 50;
export const MAX_TABLE_SIZE = 10000;

/** Allowed cell padding (px), applied to all four sides. */
export const MIN_PADDING = 0;
export const MAX_PADDING = 100;

/** Allowed line height, as a multiple of the font size (like CSS `line-height: 1.5`). */
export const MIN_LINE_HEIGHT = 0.5;
export const MAX_LINE_HEIGHT = 5;

/** Allowed font size (px). */
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 96;

/** Longest accepted font family list, e.g. `"Fira Code", monospace`. */
export const MAX_FONT_FAMILY_LENGTH = 200;

export const SCRIPTS = ["sub", "sup"] as const;
/** Subscript or superscript text. */
export type Script = (typeof SCRIPTS)[number];

/** Allowed border width (px). */
export const MIN_BORDER_WIDTH = 0;
export const MAX_BORDER_WIDTH = 20;

export const BORDER_STYLES = ["solid", "dashed", "dotted", "double", "none"] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

/** Border settings; an absent property falls back to the next level (table, then theme). */
export interface Border {
	color?: string;
	width?: number;
	style?: BorderStyle;
}

/** Width (px) or null for "automatic". */
export type ColumnWidth = number | null;

export type HorizontalAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";

/**
 * Visual properties of a cell. In a style rule, `null` explicitly resets a
 * property back to the default, overriding earlier rules.
 */
export interface CellStyle {
	bg?: string | null;
	fg?: string | null;
	bold?: boolean | null;
	italic?: boolean | null;
	align?: HorizontalAlign | null;
	valign?: VerticalAlign | null;
	/** Space (px) between the cell border and its content, on all sides. */
	padding?: number | null;
	/** Border of all four sides of the cell; overrides the table border. */
	borderColor?: string | null;
	borderWidth?: number | null;
	borderStyle?: BorderStyle | null;
	/** Line height as a multiple of the font size; overrides the table line height. */
	lineHeight?: number | null;
	/** Font size (px); overrides the table font size. */
	fontSize?: number | null;
	/** CSS font family list; overrides the table font. */
	fontFamily?: string | null;
	/** Draws the whole cell as subscript or superscript. */
	script?: Script | null;
}

export const STYLE_KEYS = [
	"bg",
	"fg",
	"bold",
	"italic",
	"align",
	"valign",
	"padding",
	"borderColor",
	"borderWidth",
	"borderStyle",
	"lineHeight",
	"fontSize",
	"fontFamily",
	"script",
] as const;
export type StyleKey = (typeof STYLE_KEYS)[number];

/** Style after all rules are resolved: no `null`, only set or absent. */
export type ResolvedStyle = {
	[K in StyleKey]?: Exclude<CellStyle[K], null>;
};

/** Zero-based, inclusive rectangle of cells. */
export interface Range {
	top: number;
	left: number;
	bottom: number;
	right: number;
}

export interface CellRef {
	row: number;
	col: number;
}

export interface StyleRule {
	range: Range;
	style: CellStyle;
}

/** Serialized form of a style rule, as stored in the note. */
export interface StyleRuleData extends CellStyle {
	range: string;
}

/** Serialized form of a table, as stored in the code block. */
export interface TableData {
	version: number;
	rows: string[][];
	merges?: string[];
	styles?: StyleRuleData[];
	widths?: ColumnWidth[];
	/** Default padding (px) for every cell; style rules can override it. */
	padding?: number;
	/** Default border for every cell; style rules can override it. */
	border?: Border;
	/** Default line height for every cell; style rules can override it. */
	lineHeight?: number;
	/** Default font size (px) for every cell; style rules can override it. */
	fontSize?: number;
	/** Default font family for every cell; style rules can override it. */
	fontFamily?: string;
	/** Number of rows at the top that form the table header. */
	header?: number;
	/** Whether the rows below the header are hidden. Needs a header. */
	collapsed?: boolean;
	/** Number of rows at the top that stay in place when the table scrolls. */
	freezeRows?: number;
	/** Number of columns at the left that stay in place when the table scrolls. */
	freezeCols?: number;
	/** Tallest the table may be (px) before it scrolls vertically in its own box. */
	maxHeight?: number;
	/** Widest the table may be (px) before it scrolls horizontally in its own box. */
	maxWidth?: number;
}
