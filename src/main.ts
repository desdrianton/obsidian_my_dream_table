import {
	FuzzySuggestModal,
	MarkdownRenderChild,
	MarkdownRenderer,
	MarkdownView,
	Menu,
	Modal,
	Notice,
	Plugin,
	Scope,
	TFile,
	parseYaml,
	type App,
	type MarkdownPostProcessorContext,
} from "obsidian";
import { CODE_BLOCK_LANGUAGE, createStarterTable, parseCodeBlock, toCodeBlock } from "./codeblock";
import {
	setBorder,
	setColor,
	setFontFamily,
	setFontSize,
	setLineHeight,
	setPadding,
	TABLE_ACTIONS,
	type TableAction,
} from "./editor/actions";
import { buildBorderPicker } from "./editor/borderPicker";
import { buildLineHeightPicker, buildPaddingPicker } from "./editor/paddingPicker";
import { buildFontFamilyPicker, buildFontSizePicker } from "./editor/fontPicker";
import { BACKGROUND_SWATCHES, buildColorPicker, TEXT_SWATCHES, type Swatch } from "./editor/colorPicker";
import { SHORTCUT_KEYS, TableEditor, type EditorState } from "./editor/TableEditor";
import { serializeTable } from "./model/serialize";
import type { TableModel } from "./model/TableModel";
import type { Range } from "./model/types";
import { renderErrors, renderTable, type RenderMarkdown } from "./render/renderTable";
import { applyLineEdit, bodyLineCount, planBodyEdit, type BlockLocation } from "./writeback";
import { locateTableBlock } from "./blocks";
import { findScrollContainer, holdScrollPosition } from "./scroll";
import { attachmentName, isImageExtension, toEmbed } from "./images";
import { enterTableExtension, type TableEntry } from "./enterTable";
import type { EditorView } from "@codemirror/view";

/** How long a saved editor state waits for the re-rendered table to pick it up. */
const STATE_HANDOFF_MS = 3000;

export default class DreamTablePlugin extends Plugin {
	/**
	 * Saving rewrites the code block, which makes Obsidian destroy and
	 * re-create the table. The old view parks its selection here, keyed by
	 * note and block position, so the new view can restore it.
	 */
	private readonly handoff = new Map<string, { state: EditorState; at: number }>();
	/** Rendered tables, so the note's cursor can hand focus to one. */
	readonly tables = new Set<DreamTableView>();

	override async onload(): Promise<void> {
		this.registerMarkdownCodeBlockProcessor(CODE_BLOCK_LANGUAGE, (source, el, ctx) => {
			ctx.addChild(new DreamTableView(this, source, el, ctx));
		});
		this.registerEditorExtension(enterTableExtension((view, entry) => this.focusTable(view, entry)));

		this.addCommand({
			id: "insert-table",
			name: "Insert table",
			editorCallback: (editor) => {
				const cursor = editor.getCursor();
				// Code fences must start on their own line.
				const prefix = editor.getLine(cursor.line).length > 0 ? "\n" : "";
				editor.replaceSelection(prefix + toCodeBlock(createStarterTable()));
			},
		});
	}

	/** Focuses the table rendered for the block at `entry` in a note editor. */
	private focusTable(view: EditorView, entry: TableEntry): boolean {
		for (const table of this.tables) {
			if (!view.contentDOM.contains(table.containerEl)) continue;
			let pos: number;
			try {
				pos = view.posAtDOM(table.containerEl);
			} catch {
				continue;
			}
			if (pos >= entry.from && pos <= entry.to) return table.enter(entry.side);
		}
		return false;
	}

	parkState(key: string, state: EditorState): void {
		this.handoff.set(key, { state, at: Date.now() });
	}

	takeState(key: string): EditorState | undefined {
		const entry = this.handoff.get(key);
		this.handoff.delete(key);
		return entry && Date.now() - entry.at < STATE_HANDOFF_MS ? entry.state : undefined;
	}

	/** The editor of `sourcePath` in Live Preview or source mode, if one is open. */
	findSourceView(sourcePath: string): MarkdownView | undefined {
		return this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.find(
				(v): v is MarkdownView =>
					v instanceof MarkdownView && v.file?.path === sourcePath && v.getMode() === "source",
			);
	}

	/**
	 * Replaces a code block's body. Goes through an open editor when there is
	 * one, so the change lands in its undo history; otherwise edits the file.
	 * The block is looked up again near `location`, since text above it may
	 * have moved it. `beforeWrite` learns where it is just before the write,
	 * which can re-render the table straight away. Returns where the block
	 * was, or null if no block matches `expectedBody` any more.
	 */
	async writeBlockBody(
		sourcePath: string,
		location: BlockLocation,
		expectedBody: string,
		newBody: string,
		beforeWrite?: (found: BlockLocation) => void,
	): Promise<BlockLocation | null> {
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) return null;

		/** The edit for the block's current location, if it can still be found. */
		const plan = (lines: string[]) => {
			const found = locateTableBlock(lines, location, expectedBody);
			const edit = found && planBodyEdit(lines, found, expectedBody, newBody);
			return found && edit ? { found, edit } : null;
		};

		const view = this.findSourceView(sourcePath);
		if (view) {
			const planned = plan(view.editor.getValue().split("\n"));
			if (!planned) return null;
			const { edit } = planned;
			beforeWrite?.(planned.found);
			view.editor.replaceRange(
				edit.text,
				{ line: edit.fromLine, ch: 0 },
				{ line: edit.toLine, ch: 0 },
			);
			return planned.found;
		}

		let written: BlockLocation | null = null;
		await this.app.vault.process(file, (data) => {
			const planned = plan(data.split("\n"));
			if (!planned) return data;
			written = planned.found;
			beforeWrite?.(planned.found);
			return applyLineEdit(data, planned.edit);
		});
		return written;
	}
}

/**
 * One table in a note. Editable when Obsidian can tell where the block is
 * in the file; read-only otherwise (e.g. inside an embed).
 */
class DreamTableView extends MarkdownRenderChild {
	private editor: TableEditor | null = null;
	private location: BlockLocation | null = null;
	/**
	 * Active while the table has focus. Obsidian handles hotkeys before the
	 * focused element sees them, so without this Ctrl+B would bold text in
	 * the note instead of the table.
	 */
	private readonly scope: Scope;
	private scopePushed = false;

	constructor(
		private readonly plugin: DreamTablePlugin,
		private source: string,
		containerEl: HTMLElement,
		private readonly ctx: MarkdownPostProcessorContext,
	) {
		super(containerEl);
		this.scope = new Scope(plugin.app.scope);
		const handled = new WeakSet<KeyboardEvent>();
		for (const key of SHORTCUT_KEYS) {
			// Registered in both cases in case matching is case-sensitive; the
			// WeakSet keeps one key press from being handled twice.
			for (const variant of [key, key.toUpperCase()]) {
				this.scope.register(["Mod"], variant, (evt) => {
					if (!this.editor?.containsFocus) {
						// Stale scope (focus left without an event): step aside.
						this.setScopeActive(false);
						return true;
					}
					if (!handled.has(evt)) {
						handled.add(evt);
						this.editor.handleShortcut(key);
					}
					return false;
				});
			}
		}
	}

	override onload(): void {
		this.plugin.tables.add(this);
		const result = parseCodeBlock(this.source, parseYaml);
		if (!result.ok) {
			renderErrors(this.containerEl, result.errors);
			return;
		}

		const renderMarkdown: RenderMarkdown = (markdown, cellEl) =>
			MarkdownRenderer.render(this.plugin.app, markdown, cellEl, this.ctx.sourcePath, this);

		const info = this.ctx.getSectionInfo(this.containerEl);
		if (!info) {
			void renderTable(result.model, this.containerEl, renderMarkdown);
			return;
		}

		this.location = { lineStart: info.lineStart, lineEnd: info.lineEnd };
		this.editor = new TableEditor(this.containerEl, result.model, {
			renderMarkdown,
			initialState: this.plugin.takeState(this.stateKey()),
			onChange: (model, state) => this.save(model, state),
			onContextMenu: (evt, range) => this.showMenu(evt, range),
			onError: (error) => new Notice(`Dream Table: ${error instanceof Error ? error.message : String(error)}`),
			onFocusChange: (focused) => this.setScopeActive(focused),
			onInsertFiles: (files) => this.saveImages(files),
			// The context menu and the dialogs it opens act on the selection.
			keepsSelection: (target) => target.closest(".menu, .modal-container") !== null,
			onExit: (side) => this.moveCursorOut(side),
		});
		void this.editor.render();
	}

	override onunload(): void {
		this.plugin.tables.delete(this);
		this.editor?.destroy();
		this.editor = null;
		this.setScopeActive(false);
	}

	/** Gives the table keyboard focus, arriving from the note's cursor. */
	enter(side: "before" | "after"): boolean {
		return this.editor?.enter(side) ?? false;
	}

	/**
	 * Saves pasted or dropped images where Obsidian puts attachments for this
	 * note (per the user's settings) and returns an embed for each.
	 */
	private async saveImages(files: File[]): Promise<string[]> {
		const { app } = this.plugin;
		const embeds: string[] = [];
		const now = new Date();
		for (const file of files) {
			const path = await app.fileManager.getAvailablePathForAttachment(
				attachmentName(file, now),
				this.ctx.sourcePath,
			);
			const saved = await app.vault.createBinary(path, await file.arrayBuffer());
			embeds.push(toEmbed(app.fileManager.generateMarkdownLink(saved, this.ctx.sourcePath)));
		}
		return embeds;
	}

	/**
	 * Puts the note's cursor at the end of the line above the block or the
	 * start of the line below it, adding an empty line when the block is at
	 * the very start or end of the note. Only possible while editing the note.
	 */
	private moveCursorOut(side: "before" | "after"): boolean {
		const view = this.plugin.findSourceView(this.ctx.sourcePath);
		if (!view || !this.location) return false;
		const { editor } = view;
		const location = locateTableBlock(editor.getValue().split("\n"), this.location, this.source);
		if (!location) return false;
		this.location = location;
		const { lineStart, lineEnd } = location;
		if (lineEnd >= editor.lineCount()) return false;

		if (side === "before") {
			if (lineStart === 0) {
				editor.replaceRange("\n", { line: 0, ch: 0 });
				editor.setCursor({ line: 0, ch: 0 });
			} else {
				editor.setCursor({ line: lineStart - 1, ch: editor.getLine(lineStart - 1).length });
			}
		} else {
			if (lineEnd === editor.lastLine()) {
				editor.replaceRange("\n", { line: lineEnd, ch: editor.getLine(lineEnd).length });
			}
			editor.setCursor({ line: lineEnd + 1, ch: 0 });
		}
		editor.focus();
		return true;
	}

	private currentScrollTop(): number | null {
		return findScrollContainer(this.containerEl)?.scrollTop ?? null;
	}

	/** Defends a scroll position while the change below re-renders the note. */
	private holdScroll(top: number | null): void {
		const scroller = findScrollContainer(this.containerEl);
		if (scroller && top !== null) holdScrollPosition(scroller, top);
	}

	private applyKeepingScroll(top: number | null, mutate: (model: TableModel) => Range | void): Promise<boolean> {
		this.holdScroll(top);
		return this.editor ? this.editor.applyChange(mutate) : Promise.resolve(false);
	}

	private setScopeActive(active: boolean): void {
		if (active === this.scopePushed) return;
		this.scopePushed = active;
		if (active) this.plugin.app.keymap.pushScope(this.scope);
		else this.plugin.app.keymap.popScope(this.scope);
	}

	private stateKey(): string {
		return `${this.ctx.sourcePath}:${this.location?.lineStart ?? -1}`;
	}

	private async save(model: TableModel, state: EditorState): Promise<boolean> {
		if (!this.location) return false;
		const body = serializeTable(model.toData());
		this.holdScroll(this.currentScrollTop());

		const written = await this.plugin.writeBlockBody(this.ctx.sourcePath, this.location, this.source, body, (found) => {
			this.location = found;
			this.plugin.parkState(this.stateKey(), state);
		});
		if (!written) {
			new Notice("Dream Table: this table was changed elsewhere. Close and reopen the note, then try again.");
			return false;
		}
		// Obsidian re-renders shortly; until then, further edits must match what we just wrote.
		this.source = body;
		this.location = {
			lineStart: written.lineStart,
			lineEnd: written.lineStart + 1 + bodyLineCount(body),
		};
		return true;
	}

	private showMenu(evt: MouseEvent, range: Range): void {
		const editor = this.editor;
		if (!editor) return;
		const model = editor.currentModel;
		// Captured now: closing the menu or a dialog can refocus the note
		// editor, which scrolls to its cursor before the change is saved.
		const scrollTop = this.currentScrollTop();
		const menu = new Menu();

		let lastSection: TableAction["section"] | null = null;
		for (const action of TABLE_ACTIONS) {
			if (lastSection && action.section !== lastSection) menu.addSeparator();
			lastSection = action.section;
			menu.addItem((item) => {
				item
					.setTitle(action.title)
					.setIcon(action.icon)
					.setDisabled(action.isEnabled ? !action.isEnabled(model, range) : false)
					.onClick(() => {
						this.holdScroll(scrollTop);
						void editor.runAction(action.id);
					});
				if (action.isChecked?.(model, range)) item.setChecked(true);
			});
		}

		menu.addItem((item) =>
			item
				.setTitle("Insert image…")
				.setIcon("image-plus")
				.onClick(() => {
					new ImageSuggestModal(this.plugin.app, (file) => {
						const embed = toEmbed(this.plugin.app.fileManager.generateMarkdownLink(file, this.ctx.sourcePath));
						this.holdScroll(scrollTop);
						void editor.appendToSelectedCell(embed);
					}).open();
				}),
		);

		const style = model.getStyle(range.top, range.left);
		/** Adds a menu item that opens a picker dialog. */
		const pickerItem = (title: string, icon: string, render: (el: HTMLElement, close: () => void) => void) =>
			menu.addItem((item) =>
				item
					.setTitle(title)
					.setIcon(icon)
					.onClick(() => new PickerModal(this.plugin.app, title.replace(/…$/, ""), render).open()),
			);
		/** Saves a change made from a picker, keeping the scroll position from when the menu opened. */
		const apply = (mutate: (m: TableModel) => void) =>
			void this.applyKeepingScroll(scrollTop, (m) => {
				mutate(m);
				return range;
			});

		menu.addSeparator();
		const colorItem = (title: string, icon: string, key: "bg" | "fg", swatches: readonly Swatch[]) =>
			pickerItem(title, icon, (el, close) =>
				buildColorPicker(el, {
					swatches,
					current: style[key],
					onPick: (color) => {
						close();
						apply((m) => setColor(m, range, key, color));
					},
				}),
			);
		colorItem("Background color…", "paint-bucket", "bg", BACKGROUND_SWATCHES);
		colorItem("Text color…", "palette", "fg", TEXT_SWATCHES);

		// Cell-level settings, each overriding the table-level one below.
		menu.addSeparator();
		pickerItem("Cell font…", "type", (el, close) =>
			buildFontFamilyPicker(el, {
				current: style.fontFamily ?? null,
				resetLabel: "Use table font",
				onPick: (fontFamily) => {
					close();
					apply((m) => setFontFamily(m, range, fontFamily));
				},
			}),
		);
		pickerItem("Cell font size…", "a-large-small", (el, close) =>
			buildFontSizePicker(el, {
				current: style.fontSize ?? null,
				resetLabel: "Use table font size",
				onPick: (fontSize) => {
					close();
					apply((m) => setFontSize(m, range, fontSize));
				},
			}),
		);
		pickerItem("Cell padding…", "square-dashed", (el, close) =>
			buildPaddingPicker(el, {
				current: style.padding ?? null,
				resetLabel: "Use table padding",
				onPick: (padding) => {
					close();
					apply((m) => setPadding(m, range, padding));
				},
			}),
		);
		pickerItem("Cell line height…", "baseline", (el, close) =>
			buildLineHeightPicker(el, {
				current: style.lineHeight ?? null,
				resetLabel: "Use table line height",
				onPick: (lineHeight) => {
					close();
					apply((m) => setLineHeight(m, range, lineHeight));
				},
			}),
		);
		pickerItem("Cell border…", "square", (el, close) =>
			buildBorderPicker(el, {
				current: {
					color: style.borderColor ?? null,
					width: style.borderWidth ?? null,
					style: style.borderStyle ?? null,
				},
				resetLabel: "Use table border",
				onApply: (choice) => {
					close();
					apply((m) => setBorder(m, range, choice));
				},
			}),
		);

		menu.addSeparator();
		pickerItem("Table font…", "type", (el, close) =>
			buildFontFamilyPicker(el, {
				current: model.tableFontFamily,
				resetLabel: "Theme default",
				onPick: (fontFamily) => {
					close();
					apply((m) => {
						m.tableFontFamily = fontFamily;
					});
				},
			}),
		);
		pickerItem("Table font size…", "a-large-small", (el, close) =>
			buildFontSizePicker(el, {
				current: model.tableFontSize,
				resetLabel: "Theme default",
				onPick: (fontSize) => {
					close();
					apply((m) => {
						m.tableFontSize = fontSize;
					});
				},
			}),
		);
		pickerItem("Table padding…", "table", (el, close) =>
			buildPaddingPicker(el, {
				current: model.tablePadding,
				resetLabel: "Theme default",
				onPick: (padding) => {
					close();
					apply((m) => {
						m.tablePadding = padding;
					});
				},
			}),
		);
		pickerItem("Table line height…", "text", (el, close) =>
			buildLineHeightPicker(el, {
				current: model.tableLineHeight,
				resetLabel: "Theme default",
				onPick: (lineHeight) => {
					close();
					apply((m) => {
						m.tableLineHeight = lineHeight;
					});
				},
			}),
		);
		pickerItem("Table border…", "table-2", (el, close) => {
			const border = model.tableBorder;
			buildBorderPicker(el, {
				current: { color: border.color ?? null, width: border.width ?? null, style: border.style ?? null },
				resetLabel: "Theme default",
				onApply: (choice) => {
					close();
					apply((m) => m.updateTableBorder(choice));
				},
			});
		});

		menu.showAtMouseEvent(evt);
	}
}

/** Searches the vault's images by path. */
class ImageSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onChoose: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("Find an image to insert…");
	}

	override getItems(): TFile[] {
		return this.app.vault.getFiles().filter((file) => isImageExtension(file.extension));
	}

	override getItemText(file: TFile): string {
		return file.path;
	}

	override onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

/** A dialog whose content is built by one of the picker builders. */
class PickerModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly render: (el: HTMLElement, close: () => void) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(this.title);
		this.render(this.contentEl, () => this.close());
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
