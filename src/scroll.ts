/** How long a saved scroll position is defended after a change. */
export const SCROLL_HOLD_MS = 500;

/**
 * Nearest ancestor of `el` that scrolls vertically (the note's scroller in
 * Live Preview or Reading view), or null.
 */
export function findScrollContainer(el: HTMLElement): HTMLElement | null {
	const view = el.ownerDocument.defaultView;
	for (let node = el.parentElement; node; node = node.parentElement) {
		if (node.scrollHeight <= node.clientHeight) continue;
		const overflowY = view?.getComputedStyle(node).overflowY ?? "";
		if (overflowY === "auto" || overflowY === "scroll") return node;
	}
	return null;
}

interface Hold {
	top: number;
	extend: () => void;
	release: () => void;
}

const activeHolds = new WeakMap<HTMLElement, Hold>();

/**
 * Keeps `scroller` at `top` for a short while. Rewriting the note re-creates
 * the table and can make the editor scroll to its cursor (often the top of
 * the note); this puts the view back. Any scrolling by the user (wheel,
 * touch, scrollbar drag) releases the hold immediately, except the event
 * that started it: a click in another table saves this one from its
 * mousedown, and that same mousedown must not undo the hold.
 *
 * If a hold is already active on the scroller, it is extended and keeps its
 * original position: the first capture was taken before any jump.
 *
 * Returns a function that releases the hold early.
 */
export function holdScrollPosition(
	scroller: HTMLElement,
	top: number,
	durationMs = SCROLL_HOLD_MS,
): () => void {
	const existing = activeHolds.get(scroller);
	if (existing) {
		existing.extend();
		return existing.release;
	}

	const view = scroller.ownerDocument.defaultView;
	let released = false;
	// Events already being dispatched (the click that started the hold) belong to this task.
	let armed = false;
	let timer: number | undefined;

	const restore = () => {
		if (!released && scroller.scrollTop !== top) scroller.scrollTop = top;
	};
	const release = () => {
		if (released) return;
		released = true;
		activeHolds.delete(scroller);
		scroller.removeEventListener("scroll", restore);
		for (const type of USER_SCROLL_EVENTS) scroller.removeEventListener(type, onUserScroll, true);
		if (timer !== undefined) view?.clearTimeout(timer);
	};
	const onUserScroll = () => {
		if (armed) release();
	};
	const extend = () => {
		if (timer !== undefined) view?.clearTimeout(timer);
		timer = view?.setTimeout(release, durationMs);
		// Editors may scroll in their next layout pass rather than synchronously.
		view?.requestAnimationFrame(() => {
			restore();
			view.requestAnimationFrame(restore);
		});
	};

	activeHolds.set(scroller, { top, extend, release });
	scroller.addEventListener("scroll", restore);
	for (const type of USER_SCROLL_EVENTS) scroller.addEventListener(type, onUserScroll, true);
	view?.setTimeout(() => (armed = true));
	restore();
	extend();
	return release;
}

const USER_SCROLL_EVENTS = ["wheel", "touchstart", "mousedown"] as const;
