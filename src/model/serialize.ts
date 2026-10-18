import { STYLE_KEYS, type TableData } from "./types";

/**
 * Writes table data as compact YAML, one table row per line, so the raw code
 * block still looks like a table. Every string is emitted as a JSON string,
 * which is also a valid YAML double-quoted scalar; this sidesteps YAML's
 * special characters (`#`, `:`, `[`, leading `-`, `yes`/`no`, ...).
 */
export function serializeTable(data: TableData): string {
	const lines = [`version: ${data.version}`, "rows:"];
	for (const row of data.rows) {
		lines.push(`  - [${row.map(quote).join(", ")}]`);
	}

	if (data.header !== undefined) {
		lines.push(`header: ${data.header}`);
	}

	if (data.collapsed) {
		lines.push("collapsed: true");
	}

	if (data.merges && data.merges.length > 0) {
		lines.push(`merges: [${data.merges.map(quote).join(", ")}]`);
	}

	if (data.widths && data.widths.length > 0) {
		lines.push(`widths: [${data.widths.map((w) => (w === null ? "null" : String(w))).join(", ")}]`);
	}

	if (data.padding !== undefined) {
		lines.push(`padding: ${data.padding}`);
	}

	if (data.lineHeight !== undefined) {
		lines.push(`lineHeight: ${data.lineHeight}`);
	}

	if (data.border && Object.keys(data.border).length > 0) {
		const parts: string[] = [];
		if (data.border.color !== undefined) parts.push(`color: ${quote(data.border.color)}`);
		if (data.border.width !== undefined) parts.push(`width: ${data.border.width}`);
		if (data.border.style !== undefined) parts.push(`style: ${quote(data.border.style)}`);
		lines.push(`border: { ${parts.join(", ")} }`);
	}

	if (data.styles && data.styles.length > 0) {
		lines.push("styles:");
		for (const rule of data.styles) {
			const parts = [`range: ${quote(rule.range)}`];
			for (const key of STYLE_KEYS) {
				const value = rule[key];
				if (value === undefined) continue;
				parts.push(`${key}: ${typeof value === "string" ? quote(value) : String(value)}`);
			}
			lines.push(`  - { ${parts.join(", ")} }`);
		}
	}

	return lines.join("\n") + "\n";
}

function quote(value: string): string {
	return JSON.stringify(value);
}
