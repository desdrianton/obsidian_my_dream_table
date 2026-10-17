/** Text and selection of a textarea. */
export interface TextState {
	text: string;
	start: number;
	end: number;
}

/**
 * A single replacement: text[from, to) becomes `insert`; afterwards the
 * selection is [selectionStart, selectionEnd) in the new text. Expressed as
 * one replacement so it can go through the browser's undo history.
 */
export interface TextEdit {
	from: number;
	to: number;
	insert: string;
	selectionStart: number;
	selectionEnd: number;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Applies an edit to a string (for tests and fallbacks). */
export function applyTextEdit(text: string, edit: TextEdit): string {
	return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/**
 * Toggles an inline marker such as `**` (bold) or `*` (italic) around the
 * selection, like Obsidian's editor:
 * - already wrapped (markers just outside or just inside) → unwrap
 * - otherwise → wrap
 * With no selection, the word under the cursor is used; outside a word, an
 * empty pair is inserted with the cursor in between.
 */
export function toggleMarker(state: TextState, marker: string): TextEdit {
	const { text } = state;
	let { start, end } = state;
	if (start === end) [start, end] = wordAt(text, start);
	[start, end] = trimSelection(text, start, end);

	const char = marker[0]!;
	const len = marker.length;
	const has = (run: number) => run === len || (run === 3 && (char === "*" || char === "_"));

	// Markers just outside the selection: **|text|**
	if (has(runBefore(text, start, char)) && has(runAfter(text, end, char))) {
		return {
			from: start - len,
			to: end + len,
			insert: text.slice(start, end),
			selectionStart: start - len,
			selectionEnd: end - len,
		};
	}

	// Markers just inside the selection: |**text**|
	const selected = text.slice(start, end);
	if (
		selected.length > 2 * len &&
		has(runAfter(selected, 0, char)) &&
		has(runBefore(selected, selected.length, char))
	) {
		return {
			from: start,
			to: end,
			insert: selected.slice(len, -len),
			selectionStart: start,
			selectionEnd: end - 2 * len,
		};
	}

	return {
		from: start,
		to: end,
		insert: marker + selected + marker,
		selectionStart: start + len,
		selectionEnd: end + len,
	};
}

/**
 * Turns the selection into a markdown link. Selected text becomes the label
 * with the cursor placed for the URL; a selected URL becomes the target with
 * the cursor placed for the label.
 */
export function insertLink(state: TextState): TextEdit {
	const [start, end] = trimSelection(state.text, state.start, state.end);
	const selected = state.text.slice(start, end);
	if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(selected)) {
		return { from: start, to: end, insert: `[](${selected})`, selectionStart: start + 1, selectionEnd: start + 1 };
	}
	const cursor = start + selected.length + 3;
	return { from: start, to: end, insert: `[${selected}]()`, selectionStart: cursor, selectionEnd: cursor };
}

/** Bounds of the word touching `pos`, or [pos, pos] if there is none. */
function wordAt(text: string, pos: number): [number, number] {
	let start = pos;
	let end = pos;
	while (start > 0 && WORD_CHAR.test(text[start - 1]!)) start--;
	while (end < text.length && WORD_CHAR.test(text[end]!)) end++;
	return [start, end];
}

/** Excludes surrounding whitespace, which markdown would not format. */
function trimSelection(text: string, start: number, end: number): [number, number] {
	while (start < end && /\s/.test(text[start]!)) start++;
	while (end > start && /\s/.test(text[end - 1]!)) end--;
	return [start, end];
}

function runBefore(text: string, pos: number, char: string): number {
	let n = 0;
	while (pos - n - 1 >= 0 && text[pos - n - 1] === char) n++;
	return n;
}

function runAfter(text: string, pos: number, char: string): number {
	let n = 0;
	while (pos + n < text.length && text[pos + n] === char) n++;
	return n;
}

/**
 * Applies an edit to a textarea through `insertText` so Ctrl+Z can undo it,
 * falling back to a direct replacement where that command is unavailable.
 */
export function applyToTextarea(textarea: HTMLTextAreaElement, edit: TextEdit): void {
	const before = textarea.value;
	const expected = applyTextEdit(before, edit);
	textarea.focus();
	textarea.setSelectionRange(edit.from, edit.to);
	let inserted = false;
	try {
		inserted = textarea.ownerDocument.execCommand("insertText", false, edit.insert);
	} catch {
		inserted = false;
	}
	if (!inserted || textarea.value !== expected) {
		// execCommand is unavailable or did something else: set the text directly.
		textarea.value = expected;
	}
	textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
	textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
