import { EditorSelection, EditorState, StateEffect, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { findTableBlock } from "./blocks";

export interface TableEntry {
	/** Document range of the block, fences included. */
	from: number;
	to: number;
	side: "before" | "after";
	/** Where the cursor would have gone, used if no table takes focus. */
	selection: EditorSelection;
}

/**
 * Focuses the rendered table at `entry` in `view`. Returns false if there
 * is none that can take focus (e.g. the block failed to parse).
 */
export type FocusTable = (view: EditorView, entry: TableEntry) => boolean;

const enterTable = StateEffect.define<TableEntry>();

/**
 * Keeps the cursor out of dreamtable blocks when it is moved there with the
 * keyboard, and moves focus into the rendered table instead. Without this,
 * Live Preview would swap the table for its YAML source.
 */
export function enterTableExtension(focusTable: FocusTable): Extension {
	const filter = EditorState.transactionFilter.of((tr) => {
		if (!tr.selection || tr.docChanged || !tr.isUserEvent("select") || tr.isUserEvent("select.pointer")) {
			return tr;
		}
		const next = tr.selection.main;
		if (!next.empty || tr.selection.ranges.length > 1) return tr;
		const doc = tr.startState.doc;
		const lineNumber = doc.lineAt(next.head).number;
		const block = findTableBlock((i) => doc.line(i + 1).text, doc.lines, lineNumber - 1);
		if (!block) return tr;
		const from = doc.line(block.lineStart + 1).from;
		const to = doc.line(block.lineEnd + 1).to;
		const prev = tr.startState.selection.main.head;
		// Already inside, e.g. editing the source after clicking into it.
		if (prev >= from && prev <= to) return tr;
		return {
			effects: enterTable.of({
				from,
				to,
				side: prev < from ? "before" : "after",
				selection: tr.selection,
			}),
		};
	});

	const plugin = ViewPlugin.fromClass(
		class {
			constructor(private readonly view: EditorView) {}

			update(update: ViewUpdate): void {
				for (const tr of update.transactions) {
					for (const effect of tr.effects) {
						if (!effect.is(enterTable)) continue;
						const entry = effect.value;
						// Focus can't change while the view is updating.
						window.setTimeout(() => {
							if (!focusTable(this.view, entry)) {
								this.view.dispatch({ selection: entry.selection, scrollIntoView: true });
							}
						});
					}
				}
			}
		},
	);

	return [filter, plugin];
}
