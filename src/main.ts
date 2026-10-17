import {
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
import { setBorder, setColor, setPadding, TABLE_ACTIONS, type TableAction } from "./editor/actions";
import { buildBorderPicker, type BorderChoice } from "./editor/borderPicker";
import { buildPaddingPicker } from "./editor/paddingPicker";
import { BACKGROUND_SWATCHES, buildColorPicker, TEXT_SWATCHES, type Swatch } from "./editor/colorPicker";
import { SHORTCUT_KEYS, TableEditor, type EditorState } from "./editor/TableEditor";
import { serializeTable } from "./model/serialize";
import type { TableModel } from "./model/TableModel";
import type { Range } from "./model/types";
import { renderErrors, renderTable, type RenderMarkdown } from "./render/renderTable";
import { applyLineEdit, bodyLineCount, planBodyEdit, type BlockLocation } from "./writeback";
import { findScrollContainer, holdScrollPosition } from "./scroll";

/** How long a saved editor state waits for the re-rendered table to pick it up. */
const STATE_HANDOFF_MS = 3000;

export default class DreamTablePlugin extends Plugin {
	/**
	 * Saving rewrites the code block, which makes Obsidian destroy and
	 * re-create the table. The old view parks its selection here, keyed by
	 * note and block position, so the new view can restore it.
	 */
	private readonly handoff = new Map<string, { state: EditorState; at: number }>();

	override async onload(): Promise<void> {
		this.registerMarkdownCodeBlockProcessor(CODE_BLOCK_LANGUAGE, (source, el, ctx) => {
			ctx.addChild(new DreamTableView(this, source, el, ctx));
		});

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

	parkState(key: string, state: EditorState): void {
		this.handoff.set(key, { state, at: Date.now() });
	}

	takeState(key: string): EditorState | undefined {
		const entry = this.handoff.get(key);
		this.handoff.delete(key);
		return entry && Date.now() - entry.at < STATE_HANDOFF_MS ? entry.state : undefined;
	}

	/**
	 * Replaces a code block's body. Goes through an open editor when there is
	 * one, so the change lands in its undo history; otherwise edits the file.
	 * Returns false if the block no longer matches `expectedBody`.
	 */
	async writeBlockBody(
		sourcePath: string,
		location: BlockLocation,
		expectedBody: string,
		newBody: string,
	): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) return false;

		const view = this.app.workspace
			.getLeavesOfType("markdown")
			.map((leaf) => leaf.view)
			.find(
				(v): v is MarkdownView =>
					v instanceof MarkdownView && v.file?.path === sourcePath && v.getMode() === "source",
			);
		if (view) {
			const edit = planBodyEdit(view.editor.getValue().split("\n"), location, expectedBody, newBody);
			if (!edit) return false;
			view.editor.replaceRange(
				edit.text,
				{ line: edit.fromLine, ch: 0 },
				{ line: edit.toLine, ch: 0 },
			);
			return true;
		}

		let written = false;
		await this.app.vault.process(file, (data) => {
			const edit = planBodyEdit(data.split("\n"), location, expectedBody, newBody);
			if (!edit) return data;
			written = true;
			return applyLineEdit(data, edit);
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
		});
		void this.editor.render();
	}

	override onunload(): void {
		this.editor?.destroy();
		this.editor = null;
		this.setScopeActive(false);
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
		this.plugin.parkState(this.stateKey(), state);

		const ok = await this.plugin.writeBlockBody(this.ctx.sourcePath, this.location, this.source, body);
		if (!ok) {
			new Notice("Dream Table: this table was changed elsewhere. Close and reopen the note, then try again.");
			return false;
		}
		// Obsidian re-renders shortly; until then, further edits must match what we just wrote.
		this.source = body;
		this.location = {
			lineStart: this.location.lineStart,
			lineEnd: this.location.lineStart + 1 + bodyLineCount(body),
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

		menu.addSeparator();
		const style = model.getStyle(range.top, range.left);
		const colorItem = (title: string, icon: string, key: "bg" | "fg", swatches: readonly Swatch[]) =>
			menu.addItem((item) =>
				item
					.setTitle(title)
					.setIcon(icon)
					.onClick(() => {
						new ColorModal(this.plugin.app, title, swatches, style[key], (color) => {
							void this.applyKeepingScroll(scrollTop, (m) => {
								setColor(m, range, key, color);
								return range;
							});
						}).open();
					}),
			);
		colorItem("Background color…", "paint-bucket", "bg", BACKGROUND_SWATCHES);
		colorItem("Text color…", "palette", "fg", TEXT_SWATCHES);

		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle("Cell padding…")
				.setIcon("square-dashed")
				.onClick(() => {
					new PaddingModal(this.plugin.app, "Cell padding", style.padding ?? null, "Use table padding", (padding) => {
						void this.applyKeepingScroll(scrollTop, (m) => {
							setPadding(m, range, padding);
							return range;
						});
					}).open();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle("Cell border…")
				.setIcon("square")
				.onClick(() => {
					const current: BorderChoice = {
						color: style.borderColor ?? null,
						width: style.borderWidth ?? null,
						style: style.borderStyle ?? null,
					};
					new BorderModal(this.plugin.app, "Cell border", current, "Use table border", (choice) => {
						void this.applyKeepingScroll(scrollTop, (m) => {
							setBorder(m, range, choice);
							return range;
						});
					}).open();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle("Table border…")
				.setIcon("table-2")
				.onClick(() => {
					const border = model.tableBorder;
					const current: BorderChoice = {
						color: border.color ?? null,
						width: border.width ?? null,
						style: border.style ?? null,
					};
					new BorderModal(this.plugin.app, "Table border", current, "Theme default", (choice) => {
						void this.applyKeepingScroll(scrollTop, (m) => {
							m.updateTableBorder(choice);
						});
					}).open();
				}),
		);
		menu.addItem((item) =>
			item
				.setTitle("Table padding…")
				.setIcon("table")
				.onClick(() => {
					new PaddingModal(this.plugin.app, "Table padding", model.tablePadding, "Theme default", (padding) => {
						void this.applyKeepingScroll(scrollTop, (m) => {
							m.tablePadding = padding;
						});
					}).open();
				}),
		);

		menu.showAtMouseEvent(evt);
	}
}

class BorderModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly current: BorderChoice,
		private readonly resetLabel: string,
		private readonly onApply: (choice: BorderChoice) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(this.title);
		buildBorderPicker(this.contentEl, {
			current: this.current,
			resetLabel: this.resetLabel,
			onApply: (choice) => {
				this.close();
				this.onApply(choice);
			},
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

class PaddingModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly current: number | null,
		private readonly resetLabel: string,
		private readonly onPick: (padding: number | null) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(this.title);
		buildPaddingPicker(this.contentEl, {
			current: this.current,
			resetLabel: this.resetLabel,
			onPick: (padding) => {
				this.close();
				this.onPick(padding);
			},
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

class ColorModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly swatches: readonly Swatch[],
		private readonly current: string | undefined,
		private readonly onPick: (color: string | null) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(this.title.replace(/…$/, ""));
		buildColorPicker(this.contentEl, {
			swatches: this.swatches,
			current: this.current,
			onPick: (color) => {
				this.close();
				this.onPick(color);
			},
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
