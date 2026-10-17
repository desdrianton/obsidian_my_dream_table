/** File extensions Obsidian can embed as images. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"] as const;

const MIME_EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	"image/bmp": "bmp",
	"image/avif": "avif",
};

export function isImageExtension(extension: string): boolean {
	return (IMAGE_EXTENSIONS as readonly string[]).includes(extension.toLowerCase());
}

/** Image files in a paste or drop, in order. Other files and plain text are ignored. */
export function imageFilesFrom(data: DataTransfer | null | undefined): File[] {
	if (!data) return [];
	return Array.from(data.files ?? []).filter((file) => file.type.startsWith("image/"));
}

/**
 * Name to save a pasted or dropped image under. Screenshots arrive with
 * generic names like "image.png", so those get Obsidian's own pattern,
 * "Pasted image 20261017123456.png"; real file names are kept.
 */
export function attachmentName(file: { name: string; type: string }, now: Date): string {
	const match = /^(.*)\.([^.]+)$/.exec(file.name);
	const extension = match?.[2] ?? MIME_EXTENSIONS[file.type] ?? "png";
	const base = match?.[1] ?? file.name;
	if (base && !/^image$/i.test(base)) return `${base}.${extension}`;
	return `Pasted image ${timestamp(now)}.${extension}`;
}

function timestamp(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
	);
}

/** Turns a link from Obsidian's generateMarkdownLink into an embed (`![[x]]` / `![](x)`). */
export function toEmbed(link: string): string {
	return link.startsWith("!") ? link : `!${link}`;
}

/** Cell content with `addition` appended on a new line. */
export function appendToCell(content: string, addition: string): string {
	if (content === "") return addition;
	return content.endsWith("\n") ? content + addition : `${content}\n${addition}`;
}
