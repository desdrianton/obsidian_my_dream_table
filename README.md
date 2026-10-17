# Dream Table

Obsidian plugin for complex tables: merged cells, background and text colors, bold/italic, and alignment.

## Usage

Run the **Dream Table: Insert table** command, or write a `dreamtable` code block:

````markdown
```dreamtable
rows:
  - [Produk, Q1, Q2, Q3]
  - [Laptop, 120, 140, 160]
  - [Mouse, 300, "", ""]
merges: [B3:D3]
styles:
  - { range: A1:D1, bg: "#1e3a8a", fg: "#ffffff", bold: true }
  - { range: B2:D3, align: right }
```
````

- **`rows`**: list of rows; each cell is markdown (links, `[[wikilinks]]`, `**bold**`, ...). Short rows are padded with empty cells.
- **`merges`**: ranges in A1 notation. Only the top-left cell's content is shown.
- **`styles`**: rules applied in order; later rules win. Properties:
  - `bg`, `fg`: `#rgb`/`#rrggbb`, color names, `rgb()`/`hsl()`, or theme variables like `var(--color-red)`
  - `bold`, `italic`: `true` / `false`
  - `align`: `left` / `center` / `right`
  - `valign`: `top` / `middle` / `bottom`
  - `padding`: space between border and content in px (0–100), overrides the table padding
  - `lineHeight`: line height as a multiple of the font size (0.5–5, e.g. `1.5`), overrides the table line height
  - `borderColor`, `borderWidth` (px, 0–20), `borderStyle` (`solid` / `dashed` / `dotted` / `double` / `none`): border on all sides of each cell, overriding the table border
  - `null` resets a property to the default
- **`widths`**: column widths in px, e.g. `[120, null, 80]`. `null` (or a missing entry) means automatic. Drag a column border in the table to set them; right-click → *Reset column widths* to go back to automatic.
- **`padding`**: default cell padding in px (0–100) for the whole table. Right-click → *Table padding…* / *Cell padding…* to set it from the table.
- **`lineHeight`**: default line height for every cell (0.5–5). Right-click → *Table line height…* / *Cell line height…* to set it from the table.
- **`border`**: default border for every cell, e.g. `{ color: "#888888", width: 1, style: "solid" }`. Any property may be left out to use the theme. Right-click → *Table border…* / *Cell border…* to set it from the table.
- **`version`**: format version, optional (currently `1`).

## Development

```bash
npm install
npm run dev        # rebuild main.js on change
npm test           # unit tests
npm run build      # typecheck + production bundle
```

To try it in a vault, copy or symlink `main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/dream-table/`, then enable **Dream Table** under Community plugins.
