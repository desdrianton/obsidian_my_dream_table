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

/** Largest row or column count the "Insert table" dialog accepts. */
export const MAX_INSERT_SIZE = 100;

/** Whether `count` is a usable row or column count for a new table. */
export function isValidInsertSize(count: number): boolean {
	return Number.isInteger(count) && count >= 1 && count <= MAX_INSERT_SIZE;
}

/**
 * Table used by the "Insert table" command. Each cell holds its own
 * 1-based position as `row_column`, e.g. `1_1`, `1_2`.
 */
export function createNumberedTable(rowCount: number, colCount: number): TableModel {
	const model = TableModel.create(rowCount, colCount);
	for (let r = 0; r < rowCount; r++) {
		for (let c = 0; c < colCount; c++) model.setCell(r, c, `${r + 1}_${c + 1}`);
	}
	return model;
}
