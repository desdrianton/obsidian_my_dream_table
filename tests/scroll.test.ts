// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findScrollContainer, holdScrollPosition, SCROLL_HOLD_MS } from "../src/scroll";

/** Makes an element report itself as scrollable content. */
function scrollable(el: HTMLElement, overflowY = "auto"): HTMLElement {
	el.style.overflowY = overflowY;
	Object.defineProperty(el, "scrollHeight", { configurable: true, value: 5000 });
	Object.defineProperty(el, "clientHeight", { configurable: true, value: 500 });
	return el;
}

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("findScrollContainer", () => {
	it("finds the nearest scrolling ancestor", () => {
		const outer = scrollable(document.createElement("div"));
		const inner = scrollable(document.createElement("div"), "scroll");
		const el = document.createElement("div");
		outer.appendChild(inner);
		inner.appendChild(el);
		document.body.appendChild(outer);
		expect(findScrollContainer(el)).toBe(inner);
	});

	it("skips ancestors that cannot scroll or have nothing to scroll", () => {
		const scroller = scrollable(document.createElement("div"));
		const hidden = scrollable(document.createElement("div"), "hidden");
		const short = document.createElement("div");
		short.style.overflowY = "auto"; // like the table's own wrapper
		const el = document.createElement("div");
		scroller.appendChild(hidden);
		hidden.appendChild(short);
		short.appendChild(el);
		document.body.appendChild(scroller);
		expect(findScrollContainer(el)).toBe(scroller);
	});

	it("returns null when nothing scrolls", () => {
		const el = document.createElement("div");
		document.body.appendChild(el);
		expect(findScrollContainer(el)).toBeNull();
	});
});

describe("holdScrollPosition", () => {
	let scroller: HTMLElement;

	beforeEach(() => {
		vi.useFakeTimers();
		scroller = scrollable(document.createElement("div"));
		document.body.appendChild(scroller);
		scroller.scrollTop = 1200;
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function jump(to: number) {
		scroller.scrollTop = to;
		scroller.dispatchEvent(new Event("scroll"));
	}

	it("puts the scroll position back after a jump", () => {
		const release = holdScrollPosition(scroller, 1200);
		jump(0);
		expect(scroller.scrollTop).toBe(1200);
		release();
	});

	it("restores immediately when the jump already happened", () => {
		scroller.scrollTop = 0;
		const release = holdScrollPosition(scroller, 1200);
		expect(scroller.scrollTop).toBe(1200);
		release();
	});

	it("stops after the hold time", () => {
		holdScrollPosition(scroller, 1200);
		vi.advanceTimersByTime(SCROLL_HOLD_MS + 1);
		jump(0);
		expect(scroller.scrollTop).toBe(0);
	});

	it.each(["wheel", "touchstart", "mousedown"])("lets the user scroll away (%s)", (type) => {
		holdScrollPosition(scroller, 1200);
		vi.advanceTimersByTime(0);
		scroller.dispatchEvent(new Event(type));
		jump(300);
		expect(scroller.scrollTop).toBe(300);
	});

	it("is not released by the mousedown that started it", () => {
		const target = document.createElement("div");
		scroller.appendChild(target);
		// Like a table saving from the capture phase of a click in another table.
		const start = () => holdScrollPosition(scroller, 1200);
		document.addEventListener("mousedown", start, true);
		target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		document.removeEventListener("mousedown", start, true);
		jump(0);
		expect(scroller.scrollTop).toBe(1200);

		vi.advanceTimersByTime(0);
		scroller.dispatchEvent(new Event("mousedown"));
		jump(300);
		expect(scroller.scrollTop).toBe(300);
	});

	it("keeps the first position when held again, and extends the time", () => {
		holdScrollPosition(scroller, 1200);
		vi.advanceTimersByTime(SCROLL_HOLD_MS - 100);
		jump(0); // the jump, restored by the first hold
		holdScrollPosition(scroller, 0); // a later capture taken after the jump
		vi.advanceTimersByTime(200);
		jump(0);
		expect(scroller.scrollTop).toBe(1200);
	});

	it("can be released early", () => {
		const release = holdScrollPosition(scroller, 1200);
		release();
		jump(10);
		expect(scroller.scrollTop).toBe(10);
	});
});
