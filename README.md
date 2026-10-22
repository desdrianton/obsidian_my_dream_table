# Dream Table

Obsidian plugin for complex tables: merged cells, background and text colors, bold/italic, and alignment.

## Usage

Run the **Dream Table: Insert table** command (it asks for the number of rows and columns, 2 × 2 by default, and fills each cell with its position as `row_column`, e.g. `1_1`, `1_2`), or write a `dreamtable` code block:

````markdown
```dreamtable
rows:
  - [Produk, Q1, Q2, Q3]
  - [Laptop, 120, 140, 160]
  - [Mouse, 300, "", ""]
header: 1
merges: [B3:D3]
styles:
  - { range: A1:D1, bg: "#1e3a8a", fg: "#ffffff", bold: true }
  - { range: B2:D3, align: right }
```
````

To turn an ordinary Markdown table into a Dream Table, put the cursor in it and run **Dream Table: Convert Markdown table to Dream Table** (or right-click → *Convert to Dream Table*). The first row becomes the header, column alignment (`:--`, `:-:`, `--:`) becomes `align` styles, `\|` becomes `|`, and `<br>` becomes a line break in the cell. Tables inside callouts stay in the callout.

- **`rows`**: list of rows; each cell is markdown (links, `[[wikilinks]]`, `**bold**`, ...). Short rows are padded with empty cells.
  Images work like anywhere else in Obsidian: `![[photo.png]]`, `![[photo.png|200]]` (no need to escape `|`), or `![](https://…)`. Paste or drop an image onto a cell to save it as an attachment and embed it, or right-click → *Insert image…* to pick one from the vault. Images shrink to fit their column.
- **`header`**: number of rows at the top that form the header (default `0`, no header). Header cells get the theme's table-header look unless styled otherwise. Right-click → *Make header (rows up to here)* / *Remove header* to set it from the table. A merge may not cross the end of the header.
- **`collapsed`**: `true` hides every row below the header. Click the chevron in the first header cell (or right-click → *Collapse table*) to toggle it; the state is saved in the note. Needs a `header`.
- **`freezeRows`**, **`freezeCols`**: number of rows at the top and columns at the left that stay in place while the rest of the table scrolls, like freeze panes in a spreadsheet (default `0`). With frozen rows the table scrolls vertically in its own box, at most 70% of the window tall unless `maxHeight` is set. A merged cell is frozen only if it lies wholly inside the frozen rows or columns. Right-click → *Freeze rows up to here* / *Freeze columns up to here* / *Unfreeze rows and columns* to set them from the table.
- **`maxHeight`**, **`maxWidth`**: largest size of the table's box in px (50–10000). A taller or wider table scrolls inside the box, and frozen rows and columns stay in place. Without them the box is as wide as the note and as tall as the table (70% of the window with frozen rows). Right-click → *Table height…* / *Table width…* to set them from the table.
- **`merges`**: ranges in A1 notation. Only the top-left cell's content is shown.
- **`styles`**: rules applied in order; later rules win. Properties:
  - `bg`, `fg`: `#rgb`/`#rrggbb`, color names, `rgb()`/`hsl()`, or theme variables like `var(--color-red)`
  - `bold`, `italic`: `true` / `false`
  - `align`: `left` / `center` / `right`
  - `valign`: `top` / `middle` / `bottom`
  - `padding`: space between border and content in px (0–100), overrides the table padding
  - `lineHeight`: line height as a multiple of the font size (0.5–5, e.g. `1.5`), overrides the table line height
  - `fontSize`: font size in px (6–96), overrides the table font size
  - `fontFamily`: a font name or CSS font list, e.g. `"Georgia, serif"`, `"\"Fira Code\", monospace"`, or a theme font like `var(--font-monospace)`; overrides the table font
  - `script`: `sub` / `sup` draws the whole cell as subscript or superscript. For part of the text, write `H<sub>2</sub>O` or `x<sup>2</sup>` in the cell.
  - `borderColor`, `borderWidth` (px, 0–20), `borderStyle` (`solid` / `dashed` / `dotted` / `double` / `none`): border on all sides of each cell, overriding the table border
  - `null` resets a property to the default
- **`widths`**: column widths in px, e.g. `[120, null, 80]`. `null` (or a missing entry) means automatic. Drag a column border in the table to set them; right-click → *Reset column widths* to go back to automatic.
- **`padding`**: default cell padding in px (0–100) for the whole table. Right-click → *Table padding…* / *Cell padding…* to set it from the table.
- **`lineHeight`**: default line height for every cell (0.5–5). Right-click → *Table line height…* / *Cell line height…* to set it from the table.
- **`fontSize`**: default font size in px (6–96) for every cell. Right-click → *Table font size…* / *Cell font size…* to set it from the table.
- **`fontFamily`**: default font for every cell. Right-click → *Table font…* / *Cell font…* to pick a theme font (text, interface, monospace), a common font, or type your own. Right-click → *Subscript* / *Superscript* toggles `script` on the selected cells.
- **`border`**: default border for every cell, e.g. `{ color: "#888888", width: 1, style: "solid" }`. Any property may be left out to use the theme. Right-click → *Table border…* / *Cell border…* to set it from the table.
- **`version`**: format version, optional (currently `1`).

If the block has a mistake (an unknown key, a bad range or color, …), the table is replaced by a list of what is wrong.

## Editing in the table

Tables are edited where they are, in Live Preview and Reading view; every change is written back to the code block (and can be undone with the note's undo while it is open in the editor). Tables shown inside an embed are read-only.

**Editing cells** (there is no separate select mode: the cell you are in is always open for editing)
- Click a cell to edit its markdown. From the note, moving the cursor into the table with the arrow keys opens its first (or last) cell.
- Arrow keys move the caret; at the edge of the text they move on to the next cell, and past the table's edge back into the note.
- Tab / Shift+Tab move to the next / previous cell; on a list item (or with several lines selected) they indent or outdent instead.
- Enter adds a line; Ctrl/Cmd+Enter saves and starts a new row below; Escape puts back the saved text; clicking elsewhere saves.
- Ctrl+B / Ctrl+I wrap the selected text in bold / italic, Ctrl+K inserts a link, Ctrl+A selects all of the cell's text.
- Task checkboxes (`- [ ] todo`) can be ticked right in the table; the change is saved to the cell.

**Selecting several cells**
- Drag across cells or Shift+click to select a range. Merged cells are always selected whole.
- Ctrl+click (Cmd+click on macOS) adds more cells to the selection; Ctrl+drag adds a range. Ctrl+click a selected cell again to deselect it. Formatting then applies to every selected cell; merging and inserting or deleting rows and columns need a single range.
- Shift+arrow grows the selection; Delete or Backspace clears the selected cells; an arrow key or Escape goes back to editing a single cell.
- Ctrl+C / Ctrl+X (Cmd on macOS) copy / cut the selected cells as tab-separated text, so they paste into another Dream Table or a spreadsheet. In an open cell with no text selected, Ctrl+C copies the whole cell.
- Ctrl+V pastes copied cells (from a Dream Table or a spreadsheet) starting at the selected cell, adding rows and columns if they do not fit; one copied cell pasted onto several selected cells fills them all. In an open cell, ordinary text is pasted at the caret.

**Right-click menu** (acts on the selection)
- *Merge cells* / *Unmerge cells*
- *Insert row above/below*, *Insert column left/right*, *Reset column widths*
- *Make header (rows up to here)*, *Remove header*, *Collapse table*
- *Freeze rows up to here*, *Freeze columns up to here*, *Unfreeze rows and columns*
- *Delete row*, *Delete column*, *Clear content*
- *Bold*, *Italic*, *Subscript*, *Superscript*, *Align left/center/right*, *Clear formatting* (Ctrl+B / Ctrl+I also toggle bold / italic on selected cells)
- *Insert image…*
- *Background color…*, *Text color…*
- *Table style…*: ready-made looks in a pastel color or a custom color of your choice. *Header row* colors and bolds the header (making the top row the header if there is none), *Header column* colors and bolds the first column, *Striped rows* colors every second row below the header. They are saved as ordinary `styles` rules, so rows added later are not striped until you apply the style again.
- *Cell font…*, *Cell font size…*, *Cell padding…*, *Cell line height…*, *Cell border…* (override the table settings for the selected cells)
- *Table font…*, *Table font size…*, *Table padding…*, *Table line height…*, *Table border…*, *Table height…*, *Table width…*

Vertical alignment (`valign`) can only be set in the code block for now.

Drag the border between two columns to resize them. Paste or drop an image onto a cell to save it as an attachment and embed it.

## Development

```bash
npm install
npm run dev        # rebuild main.js on change
npm test           # unit tests
npm run build      # typecheck + production bundle
```

To try it in a vault, copy or symlink `main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/dream-table/`, then enable **Dream Table** under Community plugins.

## About

This plugin was written 100% by [Claude Code](https://claude.com/claude-code): all code, tests, and documentation.
