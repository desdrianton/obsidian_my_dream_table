import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { enterTableExtension } from "../src/enterTable";

const doc = ["before", "```dreamtable", "rows: []", "```", "after"].join("\n");
const tableFrom = doc.indexOf("```dreamtable");
const tableTo = doc.lastIndexOf("```") + 3;

function stateAt(pos: number): EditorState {
	return EditorState.create({ doc, selection: { anchor: pos }, extensions: enterTableExtension(() => true) });
}

describe("enterTableExtension", () => {
	it("keeps keyboard moves out of the block and asks to focus the table", () => {
		const tr = stateAt(0).update({ selection: { anchor: tableFrom }, userEvent: "select" });
		expect(tr.state.selection.main.head).toBe(0);
		const entry = tr.effects[0]?.value as { from: number; to: number; side: string };
		expect(entry).toMatchObject({ from: tableFrom, to: tableTo, side: "before" });
	});

	it("enters from after the block", () => {
		const tr = stateAt(doc.length).update({ selection: { anchor: tableTo }, userEvent: "select" });
		expect(tr.state.selection.main.head).toBe(doc.length);
		expect(tr.effects[0]?.value).toMatchObject({ side: "after" });
	});

	it("lets clicks, selections and moves within the source through", () => {
		expect(stateAt(0).update({ selection: { anchor: tableFrom }, userEvent: "select.pointer" }).state.selection.main.head).toBe(tableFrom);
		expect(stateAt(0).update({ selection: { anchor: 0, head: tableFrom }, userEvent: "select" }).state.selection.main.head).toBe(tableFrom);
		expect(stateAt(tableFrom).update({ selection: { anchor: tableFrom + 4 }, userEvent: "select" }).state.selection.main.head).toBe(tableFrom + 4);
	});
});
