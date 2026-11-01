/**
 * Obsidian adds `createEl`, `createDiv` and `createSpan` to the DOM at runtime,
 * both as globals and as methods on elements. happy-dom knows nothing about
 * them, so the plugin's DOM building would fail under test without this.
 *
 * Only the parts of `DomElementInfo` the plugin uses are implemented; an
 * unknown key throws rather than being quietly dropped, so a test cannot pass
 * on behaviour Obsidian would not give us.
 */
export interface DomElementInfo {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string | number | boolean | null>;
	title?: string;
	parent?: Node;
	value?: string;
	type?: string;
	prepend?: boolean;
	placeholder?: string;
	href?: string;
}

const KNOWN_KEYS = new Set([
	"cls",
	"text",
	"attr",
	"title",
	"parent",
	"value",
	"type",
	"prepend",
	"placeholder",
	"href",
]);

function applyInfo(el: HTMLElement, info: DomElementInfo): void {
	for (const key of Object.keys(info)) {
		if (!KNOWN_KEYS.has(key)) throw new Error(`createEl: unsupported option "${key}"`);
	}
	if (info.cls !== undefined) {
		const classes = Array.isArray(info.cls) ? info.cls : info.cls.split(" ");
		el.classList.add(...classes.filter((c) => c !== ""));
	}
	if (info.text !== undefined) el.textContent = info.text;
	if (info.title !== undefined) el.setAttribute("title", info.title);
	if (info.value !== undefined) (el as HTMLInputElement).value = info.value;
	if (info.type !== undefined) (el as HTMLInputElement).type = info.type;
	if (info.placeholder !== undefined) (el as HTMLInputElement).placeholder = info.placeholder;
	if (info.href !== undefined) (el as HTMLAnchorElement).href = info.href;
	for (const [name, value] of Object.entries(info.attr ?? {})) {
		if (value === null) el.removeAttribute(name);
		else el.setAttribute(name, String(value));
	}
}

function build(
	doc: Document,
	defaultParent: Node | null,
	tag: string,
	o?: DomElementInfo | string,
	callback?: (el: HTMLElement) => void,
): HTMLElement {
	const info: DomElementInfo = typeof o === "string" ? { cls: o } : (o ?? {});
	const el = doc.createElement(tag);
	applyInfo(el, info);
	const parent = info.parent ?? defaultParent;
	if (parent) {
		if (info.prepend) parent.insertBefore(el, parent.firstChild);
		else parent.appendChild(el);
	}
	callback?.(el);
	return el;
}

/** Adds the three creators to a prototype whose instances are nodes. */
function install(proto: object): void {
	Object.defineProperties(proto, {
		createEl: {
			configurable: true,
			value(this: Node, tag: string, o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) {
				return build(this.ownerDocument ?? (this as unknown as Document), this, tag, o, cb);
			},
		},
		createDiv: {
			configurable: true,
			value(this: Node, o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) {
				return build(this.ownerDocument ?? (this as unknown as Document), this, "div", o, cb);
			},
		},
		createSpan: {
			configurable: true,
			value(this: Node, o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) {
				return build(this.ownerDocument ?? (this as unknown as Document), this, "span", o, cb);
			},
		},
		empty: {
			configurable: true,
			value(this: Node) {
				while (this.firstChild) this.removeChild(this.firstChild);
			},
		},
	});
}

// The model-only tests run in Node, where there is no DOM to extend.
if (typeof HTMLElement !== "undefined") {
	install(HTMLElement.prototype);
	install(DocumentFragment.prototype);

	const g = globalThis as Record<string, unknown>;
	g.createEl = (tag: string, o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) =>
		build(document, null, tag, o, cb);
	g.createDiv = (o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) =>
		build(document, null, "div", o, cb);
	g.createSpan = (o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) =>
		build(document, null, "span", o, cb);
}
