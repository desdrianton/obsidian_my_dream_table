// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { TableModel } from "../../src/model/TableModel";
import type { TableData } from "../../src/model/types";
import {
	applyCellStyle,
	applyCellBorder,
	applyColumnWidths,
	DEFAULT_COLUMN_WIDTH,
	renderErrors,
	renderTable,
	type RenderMarkdown,
} from "../../src/render/renderTable";

/** Stand-in for Obsidian's renderer: wraps text in <p> like MarkdownRenderer does. */
const fakeMarkdown: RenderMarkdown = async (markdown, el) => {
	const p = el.ownerDocument.createElement("p");
	p.textContent = markdown;
	el.appendChild(p);
};

function model(data: Omit<TableData, "version">): TableModel {
	const result = TableModel.parse(data);
	if (!result.ok) throw new Error(result.errors.join("; "));
	return result.model;
}

/** Text of each rendered row, one entry per <td>. */
function cellTexts(table: HTMLTableElement): string[][] {
	return Array.from(table.rows, (tr) => Array.from(tr.cells, (td) => td.textContent ?? ""));
}

let container: HTMLElement;

beforeEach(() => {
	document.body.innerHTML = "";
	container = document.createElement("div");
	document.body.appendChild(container);
});

describe("renderTable", () => {
	it("renders every cell of a plain table", async () => {
		const table = await renderTable(
			model({ rows: [["a", "b"], ["c", "d"]] }),
			container,
			fakeMarkdown,
		);
		expect(container.querySelector(".dream-table-wrapper > table.dream-table")).toBe(table);
		expect(cellTexts(table)).toEqual([
			["a", "b"],
			["c", "d"],
		]);
	});

	it("tags cells with their model coordinates", async () => {
		const table = await renderTable(model({ rows: [["a", "b"]] }), container, fakeMarkdown);
		const td = table.rows[0]!.cells[1]!;
		expect(td.dataset.row).toBe("0");
		expect(td.dataset.col).toBe("1");
	});

	it("renders merges with rowspan/colspan and skips covered cells", async () => {
		const table = await renderTable(
			model({
				rows: [
					["A1", "B1", "C1"],
					["A2", "B2", "C2"],
					["A3", "B3", "C3"],
				],
				merges: ["A1:B2", "C2:C3"],
			}),
			container,
			fakeMarkdown,
		);
		expect(cellTexts(table)).toEqual([["A1", "C1"], ["C2"], ["A3", "B3"]]);

		const anchor = table.rows[0]!.cells[0]!;
		expect(anchor.rowSpan).toBe(2);
		expect(anchor.colSpan).toBe(2);
		const vertical = table.rows[1]!.cells[0]!;
		expect(vertical.dataset.col).toBe("2");
		expect(vertical.rowSpan).toBe(2);
		expect(vertical.colSpan).toBe(1);
		expect(table.rows[2]!.cells[0]!.hasAttribute("rowspan")).toBe(false);
	});

	it("applies resolved styles to cells", async () => {
		const table = await renderTable(
			model({
				rows: [["a", "b"]],
				styles: [
					{ range: "A1:B1", bg: "#ff0000", bold: true },
					{ range: "B1", bg: "var(--color-blue)", fg: "white", align: "right" },
				],
			}),
			container,
			fakeMarkdown,
		);
		const [a, b] = Array.from(table.rows[0]!.cells);
		expect(a!.style.backgroundColor).toBe("#ff0000");
		expect(a!.style.fontWeight).toBe("bold");
		expect(a!.style.textAlign).toBe("");
		expect(b!.style.backgroundColor).toBe("var(--color-blue)");
		expect(b!.style.color).toBe("white");
		expect(b!.style.textAlign).toBe("right");
	});

	it("does not call the markdown renderer for empty cells", async () => {
		const rendered: string[] = [];
		await renderTable(model({ rows: [["x", ""], ["", "y"]] }), container, async (md, el) => {
			rendered.push(md);
			await fakeMarkdown(md, el);
		});
		expect(rendered).toEqual(["x", "y"]);
	});

	it("renders blank lines in a cell as visible empty lines", async () => {
		const rendered: string[] = [];
		await renderTable(model({ rows: [["a\n\nb"]] }), container, async (md, el) => {
			rendered.push(md);
			await fakeMarkdown(md, el);
		});
		expect(rendered).toEqual(["a\n\n&nbsp;\n\nb"]);
	});

	it("waits for asynchronous markdown rendering", async () => {
		let resolveRender!: () => void;
		const slow: RenderMarkdown = (md, el) =>
			new Promise((resolve) => {
				resolveRender = () => {
					el.textContent = md;
					resolve();
				};
			});

		let done = false;
		const promise = renderTable(model({ rows: [["late"]] }), container, slow).then((t) => {
			done = true;
			return t;
		});
		await Promise.resolve();
		expect(done).toBe(false);

		resolveRender();
		const table = await promise;
		expect(cellTexts(table)).toEqual([["late"]]);
	});

	it("renders an empty table without rows", async () => {
		const table = await renderTable(TableModel.create(0, 0), container, fakeMarkdown);
		expect(table.rows).toHaveLength(0);
	});
});

describe("column widths", () => {
	it("leaves sizing to the browser when no width is set", async () => {
		const table = await renderTable(model({ rows: [["a", "b"]] }), container, fakeMarkdown);
		expect(table.querySelectorAll("colgroup > col")).toHaveLength(2);
		expect(table.style.tableLayout).toBe("");
		expect(table.style.width).toBe("");
		expect(table.classList.contains("has-fixed-widths")).toBe(false);
	});

	it("uses a fixed layout with the stored widths", async () => {
		const table = await renderTable(
			model({ rows: [["a", "b", "c"]], widths: [100, null, 50] }),
			container,
			fakeMarkdown,
		);
		const cols = Array.from(table.querySelectorAll<HTMLTableColElement>("colgroup > col"));
		expect(cols.map((c) => c.style.width)).toEqual(["100px", `${DEFAULT_COLUMN_WIDTH}px`, "50px"]);
		expect(table.style.tableLayout).toBe("fixed");
		expect(table.style.width).toBe(`${150 + DEFAULT_COLUMN_WIDTH}px`);
		expect(table.classList.contains("has-fixed-widths")).toBe(true);
	});

	it("can switch back to automatic", async () => {
		const table = await renderTable(model({ rows: [["a"]], widths: [100] }), container, fakeMarkdown);
		applyColumnWidths(table, [null]);
		expect(table.style.tableLayout).toBe("");
		expect(table.querySelector("col")!.style.width).toBe("");
	});
});

describe("padding", () => {
	it("applies the table default inline on every cell", async () => {
		const table = await renderTable(
			model({ rows: [["a", "b"], ["c", "d"]], padding: 12, merges: ["A2:B2"] }),
			container,
			fakeMarkdown,
		);
		const cells = Array.from(table.querySelectorAll("td"));
		expect(cells).toHaveLength(3);
		for (const td of cells) expect(td.style.padding).toBe("12px");
	});

	it("leaves padding to the stylesheet without any setting", async () => {
		const table = await renderTable(model({ rows: [["a"]] }), container, fakeMarkdown);
		expect(table.rows[0]!.cells[0]!.style.padding).toBe("");
	});

	it("applies a table padding of 0", async () => {
		const table = await renderTable(model({ rows: [["a"]], padding: 0 }), container, fakeMarkdown);
		expect(table.rows[0]!.cells[0]!.style.padding).toBe("0px");
	});

	it("overrides per cell, including 0", async () => {
		const table = await renderTable(
			model({
				rows: [["a", "b", "c"]],
				padding: 12,
				styles: [
					{ range: "A1", padding: 0 },
					{ range: "B1", padding: 20 },
				],
			}),
			container,
			fakeMarkdown,
		);
		const [a, b, c] = Array.from(table.rows[0]!.cells);
		expect(a!.style.padding).toBe("0px");
		expect(b!.style.padding).toBe("20px");
		expect(c!.style.padding).toBe("12px");
	});

	it("falls back to the table default where a cell override is reset", async () => {
		const table = await renderTable(
			model({
				rows: [["a", "b"]],
				padding: 12,
				styles: [
					{ range: "A1:B1", padding: 2 },
					{ range: "B1", padding: null },
				],
			}),
			container,
			fakeMarkdown,
		);
		const [a, b] = Array.from(table.rows[0]!.cells);
		expect(a!.style.padding).toBe("2px");
		expect(b!.style.padding).toBe("12px");
	});
});

describe("line height", () => {
	it("leaves line height to the stylesheet without any setting", async () => {
		const table = await renderTable(model({ rows: [["a"]] }), container, fakeMarkdown);
		const td = table.rows[0]!.cells[0]!;
		expect(td.style.lineHeight).toBe("");
		expect(td.classList.contains("has-line-height")).toBe(false);
	});

	it("applies the table default and cell overrides inline", async () => {
		const table = await renderTable(
			model({ rows: [["a", "b"]], lineHeight: 1.5, styles: [{ range: "B1", lineHeight: 2 }] }),
			container,
			fakeMarkdown,
		);
		const [a, b] = Array.from(table.rows[0]!.cells);
		expect(a!.style.lineHeight).toBe("1.5");
		expect(a!.style.getPropertyValue("--dream-table-line-height")).toBe("1.5");
		expect(a!.classList.contains("has-line-height")).toBe(true);
		expect(b!.style.lineHeight).toBe("2");
	});
});

describe("borders", () => {
	it("leaves borders to the stylesheet without any setting", async () => {
		const table = await renderTable(model({ rows: [["a"]] }), container, fakeMarkdown);
		const td = table.rows[0]!.cells[0]!;
		expect(td.style.borderWidth).toBe("");
		expect(td.style.borderStyle).toBe("");
		expect(td.style.borderColor).toBe("");
	});

	it("applies the table border to every cell and cell overrides on top", async () => {
		const table = await renderTable(
			model({
				rows: [["a", "b"]],
				border: { color: "gray", width: 2, style: "dashed" },
				styles: [{ range: "B1", borderColor: "red", borderWidth: 4 }],
			}),
			container,
			fakeMarkdown,
		);
		const [a, b] = Array.from(table.rows[0]!.cells);
		expect([a!.style.borderWidth, a!.style.borderStyle, a!.style.borderColor]).toEqual(["2px", "dashed", "gray"]);
		expect([b!.style.borderWidth, b!.style.borderStyle, b!.style.borderColor]).toEqual(["4px", "dashed", "red"]);
	});

	it("writes only the properties that are set", () => {
		const td = document.createElement("td");
		applyCellBorder(td, { color: "blue" });
		expect(td.style.borderColor).toBe("blue");
		expect(td.style.borderWidth).toBe("");
		expect(td.style.borderStyle).toBe("");
	});

	it("draws none as hidden so neighbours cannot paint the shared edge", () => {
		const td = document.createElement("td");
		applyCellBorder(td, { style: "none", width: 0 });
		expect(td.style.borderStyle).toBe("hidden");
		expect(td.style.borderWidth).toBe("0px");
	});
});

describe("applyCellStyle", () => {
	it("sets nothing for an empty style", () => {
		const td = document.createElement("td");
		applyCellStyle(td, {});
		expect(td.getAttribute("style")).toBeNull();
	});

	it("maps every property", () => {
		const td = document.createElement("td");
		applyCellStyle(td, {
			bg: "red",
			fg: "blue",
			bold: true,
			italic: true,
			align: "center",
			valign: "bottom",
		});
		expect(td.style.backgroundColor).toBe("red");
		expect(td.style.color).toBe("blue");
		expect(td.style.fontWeight).toBe("bold");
		expect(td.style.fontStyle).toBe("italic");
		expect(td.style.textAlign).toBe("center");
		expect(td.style.verticalAlign).toBe("bottom");
	});

	it("leaves false booleans unset", () => {
		const td = document.createElement("td");
		applyCellStyle(td, { bold: false, italic: false });
		expect(td.getAttribute("style")).toBeNull();
	});
});

describe("renderErrors", () => {
	it("lists each error as text, never as HTML", () => {
		renderErrors(container, ["first", "<img src=x onerror=alert(1)>"]);
		const box = container.querySelector(".dream-table-error")!;
		const items = Array.from(box.querySelectorAll("li"), (li) => li.textContent);
		expect(items).toEqual(["first", "<img src=x onerror=alert(1)>"]);
		expect(box.querySelector("img")).toBeNull();
	});
});

describe("renderTable: header and collapse", () => {
	it("puts header rows in a thead with a collapse button in the first cell", async () => {
		const table = await renderTable(
			model({ rows: [["h"], ["a"], ["b"]], header: 1 }),
			container,
			fakeMarkdown,
		);
		expect(table.querySelectorAll("thead > tr")).toHaveLength(1);
		expect(table.querySelectorAll("tbody > tr")).toHaveLength(2);
		const button = table.querySelector("thead")!.querySelector("td[data-row='0'] > button.dream-table-collapse");
		expect(button?.getAttribute("aria-expanded")).toBe("true");
		expect(table.classList.contains("is-collapsed")).toBe(false);
	});

	it("has no thead or button without a header", async () => {
		const table = await renderTable(model({ rows: [["a"], ["b"]] }), container, fakeMarkdown);
		expect(table.querySelector("thead")).toBeNull();
		expect(table.querySelector(".dream-table-collapse")).toBeNull();
	});

	it("starts collapsed and toggles on screen without a callback", async () => {
		const table = await renderTable(
			model({ rows: [["h"], ["a"]], header: 1, collapsed: true }),
			container,
			fakeMarkdown,
		);
		const button = table.querySelector<HTMLButtonElement>(".dream-table-collapse")!;
		expect(table.classList.contains("is-collapsed")).toBe(true);
		expect(button.getAttribute("aria-expanded")).toBe("false");
		button.click();
		expect(table.classList.contains("is-collapsed")).toBe(false);
		expect(button.getAttribute("aria-expanded")).toBe("true");
	});

	it("calls the callback instead when given one", async () => {
		let calls = 0;
		const table = await renderTable(
			model({ rows: [["h"], ["a"]], header: 1 }),
			container,
			fakeMarkdown,
			() => calls++,
		);
		table.querySelector<HTMLButtonElement>(".dream-table-collapse")!.click();
		expect(calls).toBe(1);
		expect(table.classList.contains("is-collapsed")).toBe(false);
	});
});
