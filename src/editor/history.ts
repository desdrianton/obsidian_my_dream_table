import type { TableModel } from "../model/TableModel";
import { normalizeBody } from "../writeback";
import type { Selection } from "./TableEditor";

/** A table as it was at one point, with the cells selected then. */
export interface HistoryEntry {
	model: TableModel;
	selection: Selection | null;
}

/** Most changes kept for undo; older ones are dropped. */
export const HISTORY_LIMIT = 100;

/**
 * A table's undo and redo stacks. A model is never changed once it has
 * been replaced (every change works on a clone), so entries can keep it.
 */
export class UndoHistory {
	private readonly done: HistoryEntry[] = [];
	private readonly undone: HistoryEntry[] = [];

	get canUndo(): boolean {
		return this.done.length > 0;
	}

	get canRedo(): boolean {
		return this.undone.length > 0;
	}

	/** Remembers the table as it was before a change; what was undone can no longer be redone. */
	record(before: HistoryEntry): void {
		this.done.push(before);
		if (this.done.length > HISTORY_LIMIT) this.done.shift();
		this.undone.length = 0;
	}

	/** The entry to go back to, keeping `current` for redo; null if there is none. */
	undo(current: HistoryEntry): HistoryEntry | null {
		const entry = this.done.pop();
		if (!entry) return null;
		this.undone.push(current);
		return entry;
	}

	/** The entry undone last, keeping `current` for undo; null if there is none. */
	redo(current: HistoryEntry): HistoryEntry | null {
		const entry = this.undone.pop();
		if (!entry) return null;
		this.done.push(current);
		return entry;
	}
}

/** A table's undo history, and the body and line it was last saved with. */
export interface TableHistory {
	history: UndoHistory;
	body: string;
	line: number;
}

/**
 * Undo histories of the tables in each note. Saving makes Obsidian
 * re-create a table's view, so histories live here, and the new view finds
 * its own by the body it was saved with (the nearest by line if two tables
 * are the same). A table changed outside the editor, e.g. in the source or
 * with the note's own undo, no longer matches and starts a new history.
 */
export class HistoryStore {
	private readonly byPath = new Map<string, TableHistory[]>();

	/** The history of the table at `line` whose body is `body`, or a new (not yet stored) one. */
	find(path: string, body: string, line: number): TableHistory {
		const target = normalizeBody(body);
		let best: TableHistory | null = null;
		for (const entry of this.byPath.get(path) ?? []) {
			if (entry.body !== target) continue;
			if (!best || Math.abs(entry.line - line) < Math.abs(best.line - line)) best = entry;
		}
		return best ?? { history: new UndoHistory(), body: target, line };
	}

	/** Notes that the table is being saved as `body` at `line`, storing its history if it is new. */
	update(path: string, entry: TableHistory, body: string, line: number): void {
		entry.body = normalizeBody(body);
		entry.line = line;
		const list = this.byPath.get(path) ?? [];
		if (!list.includes(entry)) list.push(entry);
		this.byPath.set(path, list);
	}
}
