(function() {
	//#region src/protocol.ts
	/** Cap a string to `limit` code points, appending an ellipsis when truncated. */
	function capText(value, limit) {
		const points = Array.from(value);
		if (points.length <= limit) return value;
		return `${points.slice(0, limit).join("")}…`;
	}
	/** Normalize whitespace runs and trim an element's text for search. */
	function normalizeSearchText(value) {
		return value.replace(/\s+/g, " ").trim();
	}
	/** A bounded list of unique lowercase class names. */
	function classList(classes) {
		const out = [];
		const seen = /* @__PURE__ */ new Set();
		for (const cls of classes) {
			if (typeof cls !== "string" || cls === "") continue;
			for (const part of cls.trim().split(/\s+/)) {
				if (part === "" || seen.has(part)) continue;
				seen.add(part);
				out.push(part);
			}
			if (out.length >= 16) break;
		}
		return out;
	}
	//#endregion
	//#region src/inject/probes.ts
	/**
	* Framework probes for the page-side inject script. Each probe reads a real
	* dev-runtime signal off a DOM-like element and returns a precise or
	* heuristic source location. Pure functions over a minimal element contract
	* so they run inside the inject IIFE and are unit-testable in Node.
	*
	* Probe priority (first match wins, per node):
	*  1. code-inspector-plugin `data-insp-*` attributes — exact for every
	*     framework when the user also uses code-inspector-plugin.
	*  2. React dev `__source` on the nearest fiber's memoizedProps — exact
	*     file:line:col from the JSX transform (@vitejs/plugin-react, CRA).
	*  3. Vue dev `__file` on `__vueParentComponent.type` (v3) or
	*     `__vue__.$options` (v2) — exact file.
	*  4. Svelte dev `__svelte_meta` — exact file:line:col when present.
	*  5. Angular dev markers (`ng-reflect-*`, `_nghost-*`) — framework only,
	*     resolution falls back to the workspace search.
	*/
	/** Attributes code-inspector-plugin injects onto rendered elements. */
	const INSP_PATH = "data-insp-path";
	const INSP_ROW = "data-insp-row";
	const INSP_COL = "data-insp-col";
	function attributeOf(el, name) {
		if (typeof el.getAttribute === "function") return el.getAttribute(name);
		const attrs = el.attributes;
		if (attrs === void 0) return null;
		if (Array.isArray(attrs)) {
			const row = attrs.find((item) => item.name === name);
			return row === void 0 ? null : row.value;
		}
		if (typeof attrs.length === "number") {
			for (const item of Array.from(attrs)) if (item.name === name) return item.value;
			return null;
		}
		const value = attrs[name];
		return typeof value === "string" ? value : null;
	}
	/** The attribute names of one element (all three DOM shapes). */
	function attributeNamesOf(el) {
		const attrs = el.attributes;
		if (attrs === void 0) return [];
		if (Array.isArray(attrs)) return attrs.map((item) => item.name);
		if (typeof attrs.length === "number") return Array.from(attrs).map((item) => item.name);
		return Object.keys(attrs);
	}
	/** code-inspector-plugin's injected DOM attributes — exact for all frameworks. */
	function probeCodeInspector(el) {
		const file = attributeOf(el, INSP_PATH);
		if (file === null || file === "") return null;
		const row = attributeOf(el, INSP_ROW);
		const col = attributeOf(el, INSP_COL);
		return {
			framework: "code-inspector",
			source: {
				file,
				line: row !== null ? Number(row) || void 0 : void 0,
				column: col !== null ? Number(col) || void 0 : void 0
			}
		};
	}
	/** The React internal key on a DOM node (fiber or legacy instance). */
	function reactKeyOf(el) {
		for (const key of Object.keys(el)) if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) return key;
	}
	function fiberTypeName(type) {
		if (type === null || typeof type !== "function" && typeof type !== "object") return void 0;
		const record = type;
		return typeof record.displayName === "string" ? record.displayName : typeof record.name === "string" ? record.name : void 0;
	}
	/**
	* React probe: exact `__source` from the nearest fiber's memoizedProps when
	* the JSX transform injects it (@vitejs/plugin-react, CRA). Compilers that do
	* NOT inject `__source` (notably @vitejs/plugin-react-swc) still yield the
	* component display name, which the host turns into a component-definition
	* search.
	*/
	function probeReact(el) {
		const key = reactKeyOf(el);
		if (key === void 0) return null;
		const fiber = el[key];
		if (fiber === null || typeof fiber !== "object") return null;
		let current = fiber;
		let name;
		while (current !== null && current !== void 0) {
			if (name === void 0) name = fiberTypeName(current.elementType ?? current.type);
			const source = current.memoizedProps?.__source;
			if (typeof source === "object" && source !== null) {
				const record = source;
				if (typeof record.fileName === "string") return {
					framework: "react",
					name: fiberTypeName(current.elementType ?? current.type),
					source: {
						file: record.fileName,
						line: typeof record.lineNumber === "number" ? record.lineNumber : void 0,
						column: typeof record.columnNumber === "number" ? record.columnNumber + 1 : void 0
					}
				};
			}
			current = current.return;
		}
		return name === void 0 ? null : {
			framework: "react",
			name
		};
	}
	/** Vue 3 / Vue 2 dev `__file` off the element's owning component. */
	function probeVue(el) {
		let node = el;
		while (node !== null) {
			const parentComponent = node.__vueParentComponent;
			if (typeof parentComponent === "object" && parentComponent !== null) {
				const type = parentComponent.type;
				if (typeof type === "object" && type !== null) {
					const record = type;
					const file = typeof record.__file === "string" ? record.__file : void 0;
					if (file !== void 0) return {
						framework: "vue",
						name: typeof record.__name === "string" ? record.__name : typeof record.name === "string" ? record.name : void 0,
						source: { file }
					};
				}
			}
			const vue = node.__vue__;
			if (typeof vue === "object" && vue !== null) {
				const options = vue.$options;
				if (typeof options === "object" && options !== null) {
					const file = options.__file;
					if (typeof file === "string" && file !== "") return {
						framework: "vue",
						source: { file }
					};
				}
			}
			node = node.parentElement;
		}
		return null;
	}
	/** Svelte 5 dev `__svelte_meta` (template source location). */
	function probeSvelte(el) {
		let node = el;
		while (node !== null) {
			const meta = node.__svelte_meta;
			if (typeof meta === "object" && meta !== null) {
				const loc = meta.loc;
				if (typeof loc === "object" && loc !== null) {
					const locRecord = loc;
					const file = typeof locRecord.file === "string" ? locRecord.file : typeof locRecord.fileName === "string" ? locRecord.fileName : void 0;
					if (file !== void 0) return {
						framework: "svelte",
						source: {
							file,
							line: typeof locRecord.line === "number" ? locRecord.line : void 0,
							column: typeof locRecord.column === "number" ? locRecord.column : void 0
						}
					};
				}
			}
			node = node.parentElement;
		}
		return null;
	}
	/** Angular dev markers: `ng-reflect-*` inputs or `_nghost-*` host classes. */
	function probeAngular(el) {
		let node = el;
		while (node !== null) {
			const ngContext = node.__ngContext__;
			if (typeof ngContext !== "undefined" && ngContext !== null) return { framework: "angular" };
			if (attributeNamesOf(node).some((name) => name.startsWith("ng-reflect-") || name.startsWith("_nghost-") || name.startsWith("_ngcontent-"))) return { framework: "angular" };
			node = node.parentElement;
		}
		return null;
	}
	/** Run the probe chain for one node; null when nothing framework-specific matched. */
	function probeNode(el) {
		return probeCodeInspector(el) ?? probeReact(el) ?? probeVue(el) ?? probeSvelte(el) ?? probeAngular(el);
	}
	/** Collect the probe results for an element and its ancestors (up to depth). */
	function probeChain(el, depth = 5) {
		const out = [];
		let node = el;
		let count = 0;
		while (node !== null && count < depth) {
			const result = probeNode(node);
			if (result !== null) out.push({
				node,
				result
			});
			node = node.parentElement;
			count += 1;
		}
		return out;
	}
	/**
	* Pick the best source across the element and its ancestors: the deepest
	* exact hit (line present) wins, then the deepest file-only hit, then
	* nothing (framework still reported for display).
	*/
	function bestProbeResult(results) {
		if (results.length === 0) return null;
		return results.find((item) => item.result.source?.line !== void 0)?.result ?? results.find((item) => item.result.source !== void 0)?.result ?? results[0].result;
	}
	/** The element's tag name, lowercased. */
	function tagOf(el) {
		if (typeof el.tagName === "string" && el.tagName !== "") return el.tagName.toLowerCase();
		return "div";
	}
	/** The element's class names (handles string className and SVGAnimatedString). */
	function classesOf(el) {
		const raw = el.className;
		if (typeof raw === "string") return classList([raw]);
		if (typeof raw === "object" && raw !== null && typeof raw.baseVal === "string") return classList([raw.baseVal]);
		return [];
	}
	/** Sample attribute rows (bounded). */
	function attributesOf(el, cap = 12, valueCap = 40) {
		const attrs = el.attributes;
		if (attrs === void 0) return [];
		const rows = [];
		const push = (name, value) => {
			if (rows.length >= cap) return;
			rows.push([name, capText(value, valueCap)]);
		};
		if (Array.isArray(attrs)) for (const item of attrs) push(item.name, item.value);
		else if (typeof attrs.length === "number") for (const item of Array.from(attrs)) push(item.name, item.value);
		else {
			const record = attrs;
			for (const name of Object.keys(record)) {
				const value = record[name];
				if (typeof value === "string") push(name, value);
			}
		}
		return rows;
	}
	/** Build a short CSS selector path (element up to 5 ancestors). */
	function selectorOf(el) {
		const parts = [];
		let node = el;
		let depth = 0;
		while (node !== null && depth < 5) {
			const tag = tagOf(node);
			let piece = tag;
			if (typeof node.id === "string" && node.id !== "") piece += `#${node.id}`;
			const classes = classesOf(node).slice(0, 2);
			if (classes.length > 0) piece += `.${classes.join(".")}`;
			parts.push(piece);
			if (tag === "body" || tag === "html") break;
			node = node.parentElement;
			depth += 1;
		}
		return parts.reverse().join(" > ");
	}
	/** Build the full element descriptor for one node. */
	function describeElement(el) {
		const text = typeof el.textContent === "string" ? normalizeSearchText(el.textContent) : "";
		return {
			tag: tagOf(el),
			id: typeof el.id === "string" && el.id !== "" ? el.id : void 0,
			classes: classesOf(el),
			text: text === "" ? void 0 : capText(text, 120),
			selector: selectorOf(el),
			attrs: attributesOf(el)
		};
	}
	//#endregion
	//#region src/inject/inject.ts
	/**
	* dsh-element-source page probe (built to lib/inject.js).
	*
	* Two delivery modes:
	*  - QUEUE mode (the DSH plugin injects it into the built-in browser's page):
	*    picks are pushed into `window.__dshEsPicks` and the plugin client drains
	*    them over the Electron `<webview>` bridge — the page needs no host origin
	*    and no network access.
	*  - DIRECT mode (a <script> tag / the Vite plugin on a page opened elsewhere):
	*    picks are POSTed to the DSH host derived from the script's own URL (or
	*    `window.__DSH_ES_ORIGIN__`).
	*
	* The probe only activates on a DEVELOPMENT page: it looks for Vite's dev
	* client, webpack's HMR runtime, or Vue / Svelte / Angular / code-inspector
	* dev metadata. A production build carries none of them, so a picker there
	* could never locate a source — showing it would mislead the user.
	*
	* While active, hovering shows a dashed preview plus a "选择元素" pill at the
	* element's LOWER-RIGHT corner (not at the page corner); clicking the pill or
	* the element locates its source and queues the pick. Press Esc to pause and
	* press Esc again to resume.
	*
	* This entry has no exports: it is a plain side-effecting script.
	*/
	const MARKER = "__dshElementSourceInstalled__";
	const win = window;
	/**
	 * The pick shortcut lives on the window, not inside start(): the client
	 * pushes it right after the probe script runs, which can be before the dev-page
	 * detection finishes. start() reads this slot when it activates.
	 */
	const SHORTCUT_FALLBACK = { mode: "pill", key: "Enter", alt: false, ctrl: false, shift: false, meta: false };
	function readShortcutConfig(value) {
		if (value === null || typeof value !== "object") return { ...SHORTCUT_FALLBACK };
		return {
			mode: typeof value.mode === "string" ? value.mode : "pill",
			key: typeof value.key === "string" && value.key !== "" ? value.key : "Enter",
			alt: value.alt === true,
			ctrl: value.ctrl === true,
			shift: value.shift === true,
			meta: value.meta === true
		};
	}
	win.__dshEsShortcut = readShortcutConfig(win.__dshEsShortcut);
	win.__dshEsSetShortcut = (config) => {
		win.__dshEsShortcut = readShortcutConfig(config);
		if (typeof win.__dshEsApplyShortcut === "function") win.__dshEsApplyShortcut(win.__dshEsShortcut);
	};
	if (win[MARKER] !== true) {
		win[MARKER] = true;
		install();
	}
	/** The DSH host HTTP origin: the script's own source URL, or an explicit marker. */
	function readOrigin() {
		const scriptUrl = typeof document.currentScript === "object" && document.currentScript !== null && typeof document.currentScript.src === "string" ? document.currentScript.src : "";
		const marker = typeof win.__DSH_ES_ORIGIN__ === "string" ? win.__DSH_ES_ORIGIN__ : "";
		const candidate = marker !== "" ? marker : scriptUrl;
		if (candidate === "") return "";
		try {
			return new URL(candidate).origin;
		} catch {
			return "";
		}
	}
	/** One element's development-only metadata (any framework). */
	function hasDevMarker(el) {
		const node = el;
		return node.__vueParentComponent !== void 0 || node.__vue__ !== void 0 || node.__svelte_meta !== void 0 || node.__ngContext__ !== void 0 || el.getAttribute("data-insp-path") !== null;
	}
	/** True when the page came from a development build (dev-only markers present). */
	function isDevPage() {
		if (win.__DSH_ES_FORCE__ === true) return true;
		if (Array.from(document.scripts).some((script) => (script.src ?? "").includes("/@vite/client"))) return true;
		if (typeof win.webpackHotUpdate === "function") return true;
		if (document.documentElement !== null && hasDevMarker(document.documentElement)) return true;
		return Array.from(document.querySelectorAll("*")).slice(0, 400).some(hasDevMarker);
	}
	function install() {
		const queueMode = win.__DSH_ES_QUEUE__ === true;
		const origin = queueMode ? "" : readOrigin();
		const deliver = queueMode ? deliverToQueue : origin === "" ? null : (pick) => deliverDirect(`${origin}/dsh-element-source/api/pick`, pick);
		if (deliver === null) return;
		let attempts = 0;
		const activate = () => {
			if (isDevPage()) {
				start(deliver);
				return;
			}
			attempts += 1;
			if (attempts < 20) window.setTimeout(activate, 400);
		};
		activate();
	}
	/** Queue one pick for the plugin client (drained over the webview bridge). */
	function deliverToQueue(pick) {
		const bucket = Array.isArray(win.__dshEsPicks) ? win.__dshEsPicks : [];
		bucket.push(pick);
		if (bucket.length > 16) bucket.splice(0, bucket.length - 16);
		win.__dshEsPicks = bucket;
		return bucket.length;
	}
	/** POST one pick to the DSH host (direct-script mode). */
	function deliverDirect(endpoint, pick) {
		try {
			fetch(endpoint, {
				method: "POST",
				mode: "cors",
				keepalive: true,
				headers: { "content-type": "text/plain;charset=utf-8" },
				body: JSON.stringify(pick)
			}).catch(() => void 0);
		} catch {}
		return 0;
	}
	function start(deliver) {
		let active = false;
		let hovered = null;
		let outline = null;
		let preview = null;
		let pill = null;
		/** The pill's last placed rectangle (the pointer near it freezes the hover). */
		let pillRect = null;
		/** The keyboard / gesture shortcut configured by the client. */
		let shortcut = readShortcutConfig(win.__dshEsShortcut);
		/** Human hint shown on the pill, e.g. "Enter" or "Alt 单击". */
		const shortcutHint = () => {
			if (shortcut.mode === "key") {
				const parts = [];
				if (shortcut.ctrl) parts.push("Ctrl");
				if (shortcut.alt) parts.push("Alt");
				if (shortcut.shift) parts.push("Shift");
				if (shortcut.meta) parts.push("Meta");
				parts.push(shortcut.key === " " ? "Space" : shortcut.key);
				return parts.join("+");
			}
			if (shortcut.mode === "alt-click") return "Alt 单击";
			if (shortcut.mode === "double") return "双击";
			return "";
		};
		/** True when this keyboard event is the configured shortcut. */
		const matchesShortcut = (event) => {
			if (shortcut.mode !== "key" || event.repeat === true) return false;
			if (event.altKey !== shortcut.alt) return false;
			if (event.ctrlKey !== shortcut.ctrl) return false;
			if (event.shiftKey !== shortcut.shift) return false;
			if (event.metaKey !== shortcut.meta) return false;
			return event.key === shortcut.key;
		};
		const buildPick = (el) => {
			const best = bestProbeResult(probeChain(el));
			return {
				protocolVersion: 1,
				framework: best?.framework ?? "generic",
				source: best?.source,
				name: best?.name,
				element: describeElement(el),
				pageUrl: window.location.href
			};
		};
		const makeBox = (solid) => {
			const box = document.createElement("div");
			box.style.cssText = [
				"position:fixed",
				"z-index:2147483646",
				"pointer-events:none",
				"display:none",
				"box-sizing:border-box",
				"border-radius:2px",
				solid ? "border:2px solid #4f8cff;background:rgba(79,140,255,0.10)" : "border:1px dashed rgba(79,140,255,0.8)"
			].join(";");
			return box;
		};
		const ensureOverlay = () => {
			if (outline !== null) return;
			outline = makeBox(true);
			preview = makeBox(false);
			document.documentElement.appendChild(outline);
			document.documentElement.appendChild(preview);
		};
		const positionBox = (box, target) => {
			if (box === null) return;
			const rect = target.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) {
				box.style.display = "none";
				return;
			}
			box.style.display = "block";
			box.style.left = `${rect.left + window.scrollX}px`;
			box.style.top = `${rect.top + window.scrollY}px`;
			box.style.width = `${rect.width}px`;
			box.style.height = `${rect.height}px`;
		};
		/** The pill's add-to-chat icon (filled, the state color drives it). */
		const PILL_ICON = "<svg width=\"14\" height=\"14\" viewBox=\"0 0 1024 1024\" fill=\"currentColor\" aria-hidden=\"true\" style=\"flex:none\"><path d=\"M955.140191 657.686057L482.322585 376.382253c-17.251919-10.262738-28.340465-2.425236-24.684192 17.409508l100.538811 543.990599c3.666506 19.828604 16.083304 22.576181 27.628244 6.077415 0 0 64.233953-92.081185 116.91478-148.294464l101.060697 150.524248c9.646708 14.33652 29.105898 18.077727 43.275619 8.336876l33.92567-23.452132c14.148231-9.760295 17.830087-29.519314 8.207939-43.884486L788.174482 736.668922c67.536162-27.991518 162.961512-51.606355 162.961512-51.606354 19.460214-4.800329 21.261233-17.116843 4.004197-27.376511z\"></path><path d=\"M491.223303 891.487987H219.679793c-49.051159 0-88.897679-38.494733-88.897679-85.863576v-594.520435c0-47.365774 39.84652-85.924975 88.897679-85.924975v0.057305h583.463612c48.995901 0 88.843444 38.556131 88.843444 85.924975v346.19779h65.833381V211.160257c0-83.677794-69.426209-151.757333-154.681942-151.757332h-583.458495c-85.305875 0-154.672732 68.079538-154.672732 151.757332v594.519412c0 83.625606 69.366857 151.702074 154.672732 151.702074h271.542486v-65.893756z\"></path></svg>";
		/** Show the pill's add-to-chat face (icon + label). */
		const showAddFace = () => {
			if (pill === null) return;
			const hint = shortcutHint();
			const extra = hint === "" ? "" : "<span style='opacity:.66;margin-left:2px'>" + hint + "</span>";
			pill.innerHTML = PILL_ICON + "<span>添加到对话</span>" + extra;
		};
		const ensurePill = () => {
			if (pill !== null) return;
			pill = document.createElement("button");
			pill.type = "button";
			pill.style.cssText = [
				"position:fixed",
				"z-index:2147483647",
				"pointer-events:auto",
				"cursor:pointer",
				"border:1px solid rgba(79,140,255,0.55)",
				"border-radius:12px",
				"padding:3px 10px",
				"font:12px/1.4 -apple-system,Segoe UI,sans-serif",
				"background:rgba(20,24,32,0.9)",
				"color:#d7e3ff",
				"box-shadow:0 2px 10px rgba(0,0,0,0.35)",
				"display:none",
				"white-space:nowrap",
				"align-items:center",
				"gap:5px"
			].join(";");
			showAddFace();
			pill.style.display = "none";
			pill.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopImmediatePropagation();
				if (hovered !== null) pick(hovered);
			});
			document.documentElement.appendChild(pill);
		};
		/**
		* Place the pill at the target's lower-right corner, OUTSIDE the element so
		* it never covers the element's content. Moving the pointer toward the pill
		* freezes the hover (see {@link nearPill}), so the pill cannot chase it.
		*/
		const positionPill = (target) => {
			ensurePill();
			if (pill === null) return;
			showAddFace();
			pill.style.display = "inline-flex";
			const rect = target.getBoundingClientRect();
			const width = pill.offsetWidth > 0 ? pill.offsetWidth : 120;
			const height = pill.offsetHeight > 0 ? pill.offsetHeight : 26;
			const left = Math.max(4, Math.min(rect.right - width, window.innerWidth - width - 4));
			const top = Math.max(4, Math.min(rect.bottom + 4, window.innerHeight - height - 4));
			pill.style.left = `${left}px`;
			pill.style.top = `${top}px`;
			pillRect = {
				left,
				top,
				width,
				height
			};
		};
		/** True when the pointer is on or near the pill (the pointer is heading to it). */
		const nearPill = (x, y) => {
			if (pillRect === null) return false;
			const pad = 10;
			return x >= pillRect.left - pad && x <= pillRect.left + pillRect.width + pad && y >= pillRect.top - pad && y <= pillRect.top + pillRect.height + pad;
		};
		const hidePill = () => {
			if (pill !== null) pill.style.display = "none";
			pillRect = null;
		};
		/** Locate one element: lock the outline, queue the pick, confirm on the pill. */
		const pick = (target) => {
			ensureOverlay();
			positionBox(outline, target);
			const queued = deliver(buildPick(target));
			positionPill(target);
			if (pill !== null) pill.textContent = queued > 0 ? `已定位 · ${queued}` : "已定位";
			window.setTimeout(() => {
				if (pill !== null && pill.textContent !== null && pill.textContent.startsWith("已定位")) hidePill();
			}, 1200);
		};
		const ownElement = (target) => {
			return pill !== null && target instanceof Node && pill.contains(target);
		};
		const onPointerMove = (event) => {
			if (!active) return;
			const target = document.elementFromPoint(event.clientX, event.clientY);
			if (target === null) return;
			if (ownElement(target)) return;
			if (nearPill(event.clientX, event.clientY)) return;
			if (target === hovered) return;
			hovered = target;
			ensureOverlay();
			positionBox(preview, target);
			positionPill(target);
		};
		/**
		* While picking, page clicks are neutralized: the page action is blocked, and
		* ONLY a click on the pill picks. Clicking an element directly never picks
		* (no accidental writes to the composer).
		*/
		const onClick = (event) => {
			if (!active) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			if (ownElement(event.target) && hovered !== null) {
				pick(hovered);
				return;
			}
			if (shortcut.mode === "alt-click" && event.altKey === true) {
				const target = hovered !== null ? hovered : document.elementFromPoint(event.clientX, event.clientY);
				if (target !== null) pick(target);
			}
		};
		/** No page context menu while picking (a right-click is not a pick either). */
		const onContextMenu = (event) => {
			if (!active) return;
			event.preventDefault();
			event.stopImmediatePropagation();
		};
		/** Double-click a target to pick it (when that mode is selected). */
		const onDoubleClick = (event) => {
			if (!active || shortcut.mode !== "double") return;
			if (ownElement(event.target)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			const target = hovered !== null ? hovered : event.target;
			if (target instanceof Element) pick(target);
		};
		const onKeyDown = (event) => {
			if (event.key === "Escape") {
				setActive(false);
				return;
			}
			if (matchesShortcut(event) && hovered !== null) {
				event.preventDefault();
				event.stopImmediatePropagation();
				pick(hovered);
			}
		};
		const setActive = (next) => {
			active = next;
			document.documentElement.dataset.dshEsActive = next ? "1" : "0";
			if (active) {
				ensureOverlay();
				document.documentElement.style.cursor = "crosshair";
				document.addEventListener("pointermove", onPointerMove, true);
				document.addEventListener("click", onClick, true);
				document.addEventListener("contextmenu", onContextMenu, true);
				document.addEventListener("keydown", onKeyDown, true);
			document.addEventListener("dblclick", onDoubleClick, true);
			} else {
				hovered = null;
				document.documentElement.style.cursor = "";
				if (preview !== null) preview.style.display = "none";
				if (outline !== null) outline.style.display = "none";
				hidePill();
				document.removeEventListener("pointermove", onPointerMove, true);
				document.removeEventListener("click", onClick, true);
				document.removeEventListener("contextmenu", onContextMenu, true);
				document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("dblclick", onDoubleClick, true);
			}
		};
		win.__dshEsSetActive = (on) => {
			setActive(on === true);
		};
		/** Applies a shortcut pushed before or during activation. */
		win.__dshEsApplyShortcut = (config) => {
			shortcut = readShortcutConfig(config);
			showAddFace();
		};
		document.documentElement.dataset.dshEs = "dev";
		setActive(true);
	}
	//#endregion
})();
