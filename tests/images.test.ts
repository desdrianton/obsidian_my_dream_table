// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { appendToCell, attachmentName, imageFilesFrom, isImageExtension, toEmbed } from "../src/images";

const NOW = new Date(2026, 9, 17, 9, 5, 3);

describe("isImageExtension", () => {
	it.each(["png", "JPG", "jpeg", "gif", "webp", "svg", "bmp", "avif"])("accepts %s", (ext) =>
		expect(isImageExtension(ext)).toBe(true),
	);
	it.each(["pdf", "md", "mp4", ""])("rejects %j", (ext) => expect(isImageExtension(ext)).toBe(false));
});

describe("imageFilesFrom", () => {
	it("keeps only image files, in order", () => {
		const a = new File(["a"], "a.png", { type: "image/png" });
		const b = new File(["b"], "b.pdf", { type: "application/pdf" });
		const c = new File(["c"], "c.jpg", { type: "image/jpeg" });
		expect(imageFilesFrom({ files: [a, b, c] } as unknown as DataTransfer)).toEqual([a, c]);
	});

	it("handles missing data", () => {
		expect(imageFilesFrom(null)).toEqual([]);
		expect(imageFilesFrom(undefined)).toEqual([]);
		expect(imageFilesFrom({ files: [] } as unknown as DataTransfer)).toEqual([]);
	});
});

describe("attachmentName", () => {
	it("keeps real file names", () => {
		expect(attachmentName({ name: "diagram.png", type: "image/png" }, NOW)).toBe("diagram.png");
		expect(attachmentName({ name: "my.photo.jpeg", type: "image/jpeg" }, NOW)).toBe("my.photo.jpeg");
	});

	it("names screenshots like Obsidian does", () => {
		expect(attachmentName({ name: "image.png", type: "image/png" }, NOW)).toBe("Pasted image 20261017090503.png");
		expect(attachmentName({ name: "", type: "image/webp" }, NOW)).toBe("Pasted image 20261017090503.webp");
	});

	it("adds an extension from the type when the name has none", () => {
		expect(attachmentName({ name: "scan", type: "image/jpeg" }, NOW)).toBe("scan.jpg");
		expect(attachmentName({ name: "", type: "image/unknown" }, NOW)).toBe("Pasted image 20261017090503.png");
	});
});

describe("toEmbed", () => {
	it("turns links into embeds once", () => {
		expect(toEmbed("[[a.png]]")).toBe("![[a.png]]");
		expect(toEmbed("[](a%20b.png)")).toBe("![](a%20b.png)");
		expect(toEmbed("![[a.png]]")).toBe("![[a.png]]");
	});
});

describe("appendToCell", () => {
	it("appends on a new line", () => {
		expect(appendToCell("", "x")).toBe("x");
		expect(appendToCell("text", "x")).toBe("text\nx");
		expect(appendToCell("text\n", "x")).toBe("text\nx");
	});
});
