import { TableModel, type ModelResult } from "./model/TableModel";
import { serializeTable } from "./model/serialize";

/** Language name of the fenced code block, i.e. ```dreamtable. */
export const CODE_BLOCK_LANGUAGE = "dreamtable";

/**
 * Turns the text inside a code block into a model. The YAML parser is passed
 * in so this stays testable without Obsidian (which provides `parseYaml`).
 */
export function parseCodeBlock(source: string, parseYaml: (text: string) => unknown): ModelResult {
	if (source.trim() === "") {
		return { ok: false, errors: ["The table is empty. Add a `rows:` list to get started."] };
	}
	let raw: unknown;
	try {
		raw = parseYaml(source);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, errors: [`Invalid YAML: ${message}`] };
	}
	return TableModel.parse(raw);
}

/** Full fenced code block for a model, ready to insert into a note. */
export function toCodeBlock(model: TableModel): string {
	return "```" + CODE_BLOCK_LANGUAGE + "\n" + serializeTable(model.toData()) + "```\n";
}

/** Starter table used by the "Insert table" command. */
export function createStarterTable(): TableModel {
	const model = TableModel.create(4, 4);
	const content = [
		["Produk", "Q1", "Q2", "Q3"],
		["Laptop", "120", "140", "160"],
		["Mouse", "300", "", ""],
		["**Total**", "420", "140", "160"],
	];
	content.forEach((row, r) => row.forEach((value, c) => model.setCell(r, c, value)));
	model.merge({ top: 2, left: 1, bottom: 2, right: 3 });
	model.applyStyle({ top: 0, left: 0, bottom: 0, right: 3 }, {
		bg: "var(--color-blue)",
		fg: "#ffffff",
		bold: true,
		align: "center",
	});
	model.applyStyle({ top: 1, left: 1, bottom: 3, right: 3 }, { align: "right" });
	model.applyStyle({ top: 2, left: 1, bottom: 2, right: 3 }, { align: "center", italic: true });
	model.applyStyle({ top: 3, left: 0, bottom: 3, right: 3 }, { bg: "var(--background-secondary)" });
	return model;
}
