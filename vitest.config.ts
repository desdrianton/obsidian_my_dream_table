import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Obsidian's DOM helpers, which the plugin builds its UI with.
		setupFiles: ["./tests/setup/obsidianDom.ts"],
	},
});
