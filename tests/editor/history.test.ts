import { describe, expect, it } from "vitest";
import { TableModel } from "../../src/model/TableModel";
import { HISTORY_LIMIT, HistoryStore, UndoHistory, type HistoryEntry } from "../../src/editor/history";

const entry = (): HistoryEntry => ({ model: TableModel.create(1, 1), selection: null });

describe("UndoHistory", () => {
	it("undoes and redoes in order", () => {
		const history = new UndoHistory();
		const [a, b, c] = [entry(), entry(), entry()];
		history.record(a);
		history.record(b);
		expect(history.undo(c)).toBe(b);
		expect(history.undo(b)).toBe(a);
		expect(history.undo(a)).toBeNull();
		expect(history.redo(a)).toBe(b);
		expect(history.redo(b)).toBe(c);
		expect(history.redo(c)).toBeNull();
	});

	it("forgets what was undone once a new change is recorded", () => {
		const history = new UndoHistory();
		const [a, b] = [entry(), entry()];
		history.record(a);
		history.undo(b);
		expect(history.canRedo).toBe(true);
		history.record(a);
		expect(history.canRedo).toBe(false);
	});

	it("keeps at most HISTORY_LIMIT changes", () => {
		const history = new UndoHistory();
		const entries = Array.from({ length: HISTORY_LIMIT + 5 }, entry);
		for (const e of entries) history.record(e);
		let count = 0;
		while (history.undo(entry())) count++;
		expect(count).toBe(HISTORY_LIMIT);
	});
});

describe("HistoryStore", () => {
	it("finds a saved table's history by body, the nearest one by line", () => {
		const store = new HistoryStore();
		const first = store.find("a.md", "rows: []", 0);
		const second = store.find("a.md", "rows: []", 20);
		expect(first).not.toBe(second);
		store.update("a.md", first, "rows: [x]\n", 1);
		store.update("a.md", second, "rows: [x]", 20);
		expect(store.find("a.md", "rows: [x]", 3)).toBe(first);
		expect(store.find("a.md", "rows: [x]", 18)).toBe(second);
		expect(store.find("b.md", "rows: [x]", 1)).not.toBe(first);
	});

	it("does not match a table changed elsewhere", () => {
		const store = new HistoryStore();
		const tracked = store.find("a.md", "one", 0);
		store.update("a.md", tracked, "two", 0);
		expect(store.find("a.md", "three", 0)).not.toBe(tracked);
	});
});
