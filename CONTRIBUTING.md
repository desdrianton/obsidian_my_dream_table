# Contributing

## Development

```bash
npm install
npm run dev        # rebuild main.js on change
npm test           # unit tests
npm run build      # typecheck + production bundle
```

To try it in a vault, copy or symlink `main.js`, `manifest.json`, and `styles.css` into
`<vault>/.obsidian/plugins/dream-table/`, then enable **Dream Table** under Community plugins.

## Layout

- `src/model/` — the table itself: cells, merges, styles, and reading and writing the block's YAML.
- `src/render/` — turning a model into a `<table>`.
- `src/editor/` — selection, keyboard and mouse handling, and the pickers behind the right-click menu.
- `src/main.ts` — the Obsidian plugin: commands, the code block processor, and writing changes back to the note.
- `tests/` — unit tests, run with [Vitest](https://vitest.dev) against happy-dom.
- `tests/setup/obsidianDom.ts` — stands in for the DOM helpers (`createEl` and friends)
  that Obsidian adds at runtime and happy-dom does not have.

## Releases

Pushing a tag of the form `x.y.z` runs `.github/workflows/release.yml`, which checks
the tag against `manifest.json`, runs the tests, builds, attests the assets, and
drafts a GitHub release with `main.js`, `manifest.json` and `styles.css`.

Before tagging, bump `version` in `manifest.json` and `package.json` and add the new
version to `versions.json`.
