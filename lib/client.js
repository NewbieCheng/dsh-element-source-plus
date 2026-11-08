window.__ModuleLoader__.load({
	id: "dsh-element-source-plus",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/draft.ts
		/** The draft text for one located source (fallback plain text). */
		function buildDraftText(result) {
			const relative = result.relative ?? "";
			return `[元素定位] ${result.line !== void 0 ? `${relative}:${result.line}` : relative}`;
		}
		/** The workspace-relative path as the `@` file menu spells it (POSIX slashes). */
		function mentionPath(relative) {
			return relative.replace(/\\/g, "/");
		}
		/** The `@path` mention text of one located source (quoted when it has spaces). */
		function buildMention(relative) {
			const path = mentionPath(relative);
			return /\s/.test(path) ? `@"${path}"` : `@${path}`;
		}
		/**
		* The mention text carrying the located line, e.g. `@src/App.tsx:12`. The
		* reference serializes to this text, so the model receives the line — a chip
		* labeled `App.tsx:12` alone leaves the agent reading the whole file.
		*/
		function mentionWithLine(relative, line) {
			const mention = buildMention(relative);
			if (line === void 0) return mention;
			return mention.endsWith("\"") ? `${mention.slice(0, -1)}:${line}"` : `${mention}:${line}`;
		}
		/** The reference chip payload of one located source. */
		function buildReference(relative, line) {
			const mention = mentionWithLine(relative, line);
			const path = mentionPath(relative);
			const base = path.slice(path.lastIndexOf("/") + 1);
			return {
				source: "reference",
				ref: mention,
				label: line !== void 0 ? `${base}:${line}` : base,
				appearance: "file",
				clipboardText: mention
			};
		}
		/** Resolve the conversation service for one session (0.2.x session scope first). */
		function conversationOf(ctx, scope) {
			const scoped = scope;
			if (typeof scoped.get === "function") {
				const fromScope = scoped.get("conversation");
				if (fromScope !== void 0) return fromScope;
			}
			return ctx.reflect.get("conversation");
		}
		/**
		* Insert a located source into the session's composer draft as a file
		* reference chip (falling back to plain `[元素定位]` text when the chip API is
		* unavailable). Never sends anything; returns false (logged, no throw) when the
		* conversation service or session scope is unavailable.
		*/
		function insertLocatedSource(ctx, sessionId, relative, line) {
			try {
				const scope = ctx.sessions?.scope?.(sessionId);
				if (scope === void 0) return false;
				const conversation = conversationOf(ctx, scope);
				if (conversation === void 0) return false;
				const input = conversation.input.for(scope);
				const reference = buildReference(relative, line);
				const editor = input.draftEditor;
				if (editor !== void 0 && typeof editor.insertFileReferences === "function" && editor.insertFileReferences([reference])) return true;
				const current = input.state.getSnapshot().draft;
				const text = buildDraftText({
					relative,
					line
				});
				input.setDraft(current.trim() === "" ? text : `${current} ${text}`);
				return true;
			} catch (error) {
				console.warn("[dsh-element-source] draft fill failed:", error);
				return false;
			}
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Client half of dsh-element-source.
		*
		* The plugin owns no preview UI of its own: the DSH built-in browser is the
		* surface. Here we
		*  - inject the page probe into the built-in browser's Electron `<webview>`
		*    pages (queue mode: the probe stashes picks in `window.__dshEsPicks`),
		*  - drain those picks and hand them to the host,
		*  - append a picker switch as the LAST button of the browser's own toolbar
		*    (only for a development page) so it reads as a native toolbar tool, and
		*  - poll the host for resolved locations and fill the CURRENT session's
		*    composer draft (never sends it).
		*
		* All host calls are same-origin relative URLs: the desktop app proxies
		* `dsh-app://app/*` to its own web server (with authentication), and the web
		* GUI is same-origin by definition — no port or origin is ever needed.
		*/
		/** Services required before mounting (the slot registry + client sessions). */
		const inject = ["slots", "sessions"];
		/** The frame-wide overlay entry hosting the invisible machinery. */
		const OVERLAY_ID = "dsh-element-source.ui";
		/** Interval of one drain + pending poll. */
		const POLL_MS = 300;
		/** Marker attribute of the toolbar switch we append. */
		const SWITCH_ATTR = "data-dsh-element-source-switch";
		/** The switch's own stylesheet (injected once, matches the toolbar tools). */
		const SWITCH_STYLE_ID = "dsh-element-source-switch-style";
		/** Read the current session's id + cwd (undefined before a session is retained). */
		function readSessionScope(ctx) {
			const snap = ctx.sessions?.list?.getSnapshot?.();
			if (snap === void 0) return void 0;
			const byId = snap.byId ?? {};
			const currentId = snap.current !== void 0 && snap.current !== "" ? snap.current : Object.values(byId).find((entry) => (entry.retainedBy?.mainView ?? 0) > 0)?.id;
			if (currentId === void 0) return void 0;
			return {
				sessionId: currentId,
				cwd: byId[currentId]?.cwd
			};
		}
		/** The probe source, fetched once per GUI lifetime. */
		let probeSource;
		function loadProbeSource() {
			probeSource ??= (async () => {
				try {
					const response = await fetch("/dsh-element-source/inject.js", { cache: "no-store" });
					return response.ok ? await response.text() : void 0;
				} catch {
					return;
				}
			})();
			return probeSource;
		}
		/** Inject the probe (queue mode) into one Electron `<webview>` page. */
		async function injectProbe(webview) {
			const execute = webview.executeJavaScript;
			if (typeof execute !== "function") return false;
			const source = await loadProbeSource();
			if (source === void 0) return false;
			try {
				await execute.call(webview, `window.__DSH_ES_QUEUE__ = true;\n${source}`, true);
				return true;
			} catch {
				return false;
			}
		}
		/** Read and clear one webview's queued picks plus the picker state. */
		async function drainWebview(webview) {
			const execute = webview.executeJavaScript;
			if (typeof execute !== "function") return void 0;
			try {
				const raw = await execute.call(webview, "(function(){var p=window.__dshEsPicks||[];window.__dshEsPicks=[];var d=document.documentElement.dataset||{};return JSON.stringify({p:p,dev:d.dshEs||\"\",on:d.dshEsActive||\"\"})})()", true);
				if (typeof raw !== "string") return void 0;
				const parsed = JSON.parse(raw);
				return {
					picks: Array.isArray(parsed.p) ? parsed.p.filter((item) => typeof item === "object" && item !== null) : [],
					dev: parsed.dev === "dev",
					enabled: parsed.on === "1"
				};
			} catch {
				return;
			}
		}
		/** Watch the built-in browser's webviews and inject the probe on every load. */
		function useWebviewProbe() {
			(0, react.useEffect)(() => {
				const hooked = /* @__PURE__ */ new WeakSet();
				const hook = (webview) => {
					if (hooked.has(webview)) return;
					hooked.add(webview);
					const inject = () => {
						const url = webview.getURL?.() ?? webview.src ?? "";
						if (url === "" || url === "about:blank") return;
						injectProbe(webview);
					};
					webview.addEventListener("dom-ready", inject);
					webview.addEventListener("did-navigate", inject);
					webview.addEventListener("did-navigate-in-page", inject);
					inject();
				};
				const scan = () => {
					for (const webview of Array.from(document.querySelectorAll("webview"))) hook(webview);
				};
				scan();
				const observer = new MutationObserver(scan);
				observer.observe(document.documentElement, {
					childList: true,
					subtree: true
				});
				return () => observer.disconnect();
			}, []);
		}
		/** Same-origin POST of one queued pick to the host. */
		async function tellHost(pick) {
			try {
				await fetch("/dsh-element-source/api/pick", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(pick)
				});
			} catch {}
		}
		/** The webview's own toolbar element (the row holding its address input). */
		function toolbarOf(webview) {
			const rect = webview.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return void 0;
			return Array.from(document.querySelectorAll("input")).find((input) => {
				const box = input.getBoundingClientRect();
				return box.width > 120 && box.bottom <= rect.top + 6 && box.top >= rect.top - 48 && box.left >= rect.left - 4;
			})?.parentElement?.parentElement ?? void 0;
		}
		/** One-time stylesheet for the toolbar switch (hover behaves like a tool). */
		function ensureSwitchStyle() {
			if (document.getElementById(SWITCH_STYLE_ID) !== null) return;
			const style = document.createElement("style");
			style.id = SWITCH_STYLE_ID;
			style.textContent = [
				`[${SWITCH_ATTR}]{width:28px;height:28px;padding:0;border:0;border-radius:6px;`,
				"  background:var(--dsh-es-switch-bg,transparent);color:var(--dsh-es-switch-fg,inherit);",
				"  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none;",
				"  transition:background 120ms ease,color 120ms ease}",
				`[${SWITCH_ATTR}]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,0.12))}`,
				`[${SWITCH_ATTR}][data-on="1"]:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f8cff) 26%,transparent)}`
			].join("\n");
			document.head.appendChild(style);
		}
		/** The user's select-element icon (1024 grid, filled): the state color drives it. */
		const SWITCH_ICON = "<svg width=\"16\" height=\"16\" viewBox=\"0 0 1024 1024\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M955.140191 657.686057L482.322585 376.382253c-17.251919-10.262738-28.340465-2.425236-24.684192 17.409508l100.538811 543.990599c3.666506 19.828604 16.083304 22.576181 27.628244 6.077415 0 0 64.233953-92.081185 116.91478-148.294464l101.060697 150.524248c9.646708 14.33652 29.105898 18.077727 43.275619 8.336876l33.92567-23.452132c14.148231-9.760295 17.830087-29.519314 8.207939-43.884486L788.174482 736.668922c67.536162-27.991518 162.961512-51.606355 162.961512-51.606354 19.460214-4.800329 21.261233-17.116843 4.004197-27.376511z\"></path><path d=\"M491.223303 891.487987H219.679793c-49.051159 0-88.897679-38.494733-88.897679-85.863576v-594.520435c0-47.365774 39.84652-85.924975 88.897679-85.924975v0.057305h583.463612c48.995901 0 88.843444 38.556131 88.843444 85.924975v346.19779h65.833381V211.160257c0-83.677794-69.426209-151.757333-154.681942-151.757332h-583.458495c-85.305875 0-154.672732 68.079538-154.672732 151.757332v594.519412c0 83.625606 69.366857 151.702074 154.672732 151.702074h271.542486v-65.893756z\"></path></svg>";
		/** The live toggle handler per switch button (refreshed every cycle). */
		const switchHandlers = /* @__PURE__ */ new WeakMap();
		/** Append (or refresh) the switch as the toolbar's LAST child. */
		function ensureSwitch(toolbar, enabled, onToggle) {
			ensureSwitchStyle();
			let button = toolbar.querySelector(`[${SWITCH_ATTR}]`);
			if (button === null) {
				button = document.createElement("button");
				button.type = "button";
				button.setAttribute(SWITCH_ATTR, "");
				button.innerHTML = SWITCH_ICON;
				button.style.flex = "none";
				const created = button;
				created.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					switchHandlers.get(created)?.();
				});
			}
			switchHandlers.set(button, onToggle);
			if (toolbar.lastElementChild !== button) toolbar.appendChild(button);
			button.dataset.on = enabled ? "1" : "0";
			button.title = enabled ? "关闭元素定位（Esc）" : "开启元素定位";
			button.setAttribute("aria-label", button.title);
			button.style.setProperty("--dsh-es-switch-fg", enabled ? "var(--dsw-alias-brand-primary, #4f8cff)" : "var(--dsw-alias-label-secondary, #c0c4cc)");
			button.style.setProperty("--dsh-es-switch-bg", enabled ? "color-mix(in srgb, var(--dsw-alias-brand-primary, #4f8cff) 16%, transparent)" : "transparent");
		}
		/** Locations inserted as reference chips, keyed by the chip's display label. */
		const locatedChips = /* @__PURE__ */ new Map();
		/** Encode one address path segment (colons stay literal, matching the @ menu). */
		function encodeSegment(segment) {
			return encodeURIComponent(segment).replace(/%3A/gi, ":");
		}
		/** The `dsh-resource://file/session/<id>/<path>` address the preview opens. */
		function fileAddress(sessionId, relative) {
			const path = relative.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
			return `dsh-resource://file/session/${encodeSegment(sessionId)}/${path.split("/").map(encodeSegment).join("/")}`;
		}
		/** Open the located file preview at its line (the sidebar's document preview). */
		function openLocatedSource(ctx, sessionId, located) {
			const sidebar = ctx;
			const service = sidebar.get?.("sidebarRight") ?? sidebar.reflect?.get("sidebarRight");
			if (typeof service?.openResource !== "function") return;
			const address = fileAddress(sessionId, located.relative);
			service.openResource(address, located.line !== void 0 ? { params: { line: located.line } } : void 0);
		}
		/** Remove the switch from a toolbar (a page that is not a development page). */
		function removeSwitch(toolbar) {
			const button = toolbar.querySelector(`[${SWITCH_ATTR}]`);
			if (button !== null) button.remove();
		}
		/** One drain + poll cycle: probe picks to the host, resolved picks to the draft. */
		async function cycle(ctx, state, webviewRef) {
			for (const webview of Array.from(document.querySelectorAll("webview"))) {
				const drained = await drainWebview(webview);
				if (drained === void 0) continue;
				const toolbar = toolbarOf(webview);
				if (toolbar !== void 0 && drained.dev) {
					webviewRef.current = webview;
					ensureSwitch(toolbar, drained.enabled, () => {
						const current = webviewRef.current;
						const execute = current?.executeJavaScript;
						if (execute === void 0) return;
						execute.call(current, `window.__dshEsSetActive(${drained.enabled ? "false" : "true"})`, true);
					});
				} else if (toolbar !== void 0) removeSwitch(toolbar);
				if (drained.picks.length > 0) for (const pick of drained.picks) await tellHost(pick);
			}
			const scope = readSessionScope(ctx);
			if (scope === void 0) return;
			const params = new URLSearchParams({
				after: String(state.lastSeq),
				sessionId: scope.sessionId
			});
			if (scope.cwd !== void 0 && scope.cwd !== "") params.set("cwd", scope.cwd);
			const response = await fetch(`/dsh-element-source/api/pending?${params.toString()}`);
			if (!response.ok) return;
			const body = await response.json();
			const value = body.value;
			if (body.ok !== true || value === void 0) return;
			state.lastSeq = typeof value.sequence === "number" ? value.sequence : state.lastSeq;
			for (const result of value.results ?? []) if (result.ok === true && result.relative !== void 0) {
				if (insertLocatedSource(ctx, scope.sessionId, result.relative, result.line)) locatedChips.set(buildReference(result.relative, result.line).label, {
					relative: result.relative,
					line: result.line
				});
			}
		}
		/**
		* The invisible overlay entry: webview probe injection, the toolbar switch, and
		* the drain/poll loop.
		* @param props - the client context.
		*/
		function ElementSourceHooks(props) {
			const { ctx } = props;
			useWebviewProbe();
			const webviewRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const state = { lastSeq: 0 };
				let busy = false;
				const tick = async () => {
					if (busy) return;
					busy = true;
					try {
						await cycle(ctx, state, webviewRef);
					} catch {} finally {
						busy = false;
					}
				};
				tick();
				const timer = window.setInterval(() => {
					tick();
				}, POLL_MS);
				return () => window.clearInterval(timer);
			}, [ctx]);
			(0, react.useEffect)(() => {
				const onClick = (event) => {
					const chip = event.target?.closest?.("[data-composer-chip=\"reference\"]");
					if (chip === null) return;
					const located = locatedChips.get((chip.textContent ?? "").trim());
					if (located === void 0) return;
					const scope = readSessionScope(ctx);
					if (scope === void 0) return;
					event.preventDefault();
					event.stopImmediatePropagation();
					openLocatedSource(ctx, scope.sessionId, located);
				};
				document.addEventListener("click", onClick, true);
				return () => document.removeEventListener("click", onClick, true);
			}, [ctx]);
			return react.default.createElement(react.default.Fragment);
		}
		/**
		* Client plugin entry: mount the invisible hooks entry in the frame overlay.
		* @param ctx - the client cordis context (slots, sessions).
		*/
		function apply(ctx) {
			try {
				installToolbar(ctx);
			} catch {}
			const slots = ctx.slots;
			if (slots === void 0) return;
			ctx.effect(() => slots.inject("shell.overlay", () => slots.register({
				name: "shell.overlay",
				id: OVERLAY_ID,
				order: 100
			}, () => react.default.createElement(ElementSourceHooks, { ctx }))), "dsh-element-source: picker hooks");
		}

		/* ================================================================== *
		 * dsh-element-source-plus: the browser toolbar menu.
		 *
		 * One "menu" button appended to the built-in browser's own toolbar,
		 * opening a two-level menu: zoom percentage (native setZoomFactor),
		 * viewport presets, open-in-system-browser, DevTools and the console
		 * error log. Wrapped in an IIFE so none of these names can shadow the
		 * element-source half above (which has its own toolbarOf()).
		 * ================================================================== */
		const installToolbar = (() => {
			const VERSION = "1.0.0";
			const BAR_ATTR = "data-dsh-es-plus-bar";
			const PANEL_ATTR = "data-dsh-es-plus-panel";
			const STYLE_ID = "dsh-es-plus-style";
			const TICK_MS = 1000;
			const REPO_URL = "https://github.com/NewbieCheng/dsh-element-source-plus";
			const PING_URL = "/dsh-element-source-plus/api/ping";

			const BAR_SEL = "[" + BAR_ATTR + "]";
			const PANEL_ATTR_ID = "[" + PANEL_ATTR + "]";

			const ZOOMS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 200];
			const WIDTHS = [
				{ id: "desktop", label: "电脑", hint: "占满面板", width: 0 },
				{ id: "tablet", label: "平板", hint: "768 px", width: 768 },
				{ id: "phone", label: "手机", hint: "390 px", width: 390 }
			];
			const EXTERNAL_RE = /(系统浏览器|外部浏览器|默认浏览器|system\s*browser|external|open\s*in\s*browser)/i;

			const states = new WeakMap();
			const hooked = new WeakSet();
			const bars = new Set();
			const hidden = new Map();

			function stateOf(webview) {
				let state = states.get(webview);
				if (state === undefined) {
					state = { zoom: 100, width: "desktop", errors: [], panel: null, sub: null, subKind: null, kind: null, toolbar: void 0, labels: [], bar: void 0 };
					states.set(webview, state);
				}
				return state;
			}

			function toolbarOf(webview) {
				const rect = webview.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return void 0;
				const input = Array.from(document.querySelectorAll("input")).find((field) => {
					const box = field.getBoundingClientRect();
					return box.width > 120 && box.bottom <= rect.top + 6 && box.top >= rect.top - 48;
				});
				const row = input && input.parentElement && input.parentElement.parentElement;
				return row || void 0;
			}

			/**
			 * The address input stays at the pane's left edge while the guest can
			 * be narrowed and centred, so a fresh geometric scan stops matching
			 * once a viewport preset narrows the page - which used to delete the
			 * bar. The cached row wins as long as it is still in the document.
			 */
			function resolveToolbar(webview, state) {
				const cached = state.toolbar;
				if (cached && cached.isConnected && cached.querySelector(BAR_SEL) !== null) return cached;
				const found = toolbarOf(webview);
				if (found !== void 0) state.toolbar = found;
				return found;
			}

			function ensureStyle() {
				if (document.getElementById(STYLE_ID) !== null) return;
				const style = document.createElement("style");
				style.id = STYLE_ID;
				style.textContent = [
					BAR_SEL + "{display:inline-flex;align-items:center;flex:none;margin-left:4px}",
					BAR_SEL + " button{width:28px;height:28px;padding:0;border:0;border-radius:6px;",
					"  background:transparent;color:var(--dsw-alias-label-secondary,#c0c4cc);",
					"  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;",
					"  flex:none;transition:background 120ms ease,color 120ms ease}",
					BAR_SEL + " button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}",
					BAR_SEL + " button[data-bt-open='1']{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));",
					"  color:var(--dsw-alias-label-primary,#f2f3f5)}",
					BAR_SEL + " button[data-bt-err='1']{color:#e5484d}",
					BAR_SEL + " button[data-bt-err='1']:hover{background:color-mix(in srgb,#e5484d 18%,transparent)}",
					PANEL_ATTR_ID + "{position:fixed;z-index:2147483000;min-width:186px;max-width:300px;",
					"  max-height:60vh;overflow:auto;padding:5px;border-radius:10px;",
					"  background:var(--dsw-alias-bg-elevated,#22242a);color:var(--dsw-alias-label-primary,#f2f3f5);",
					"  border:1px solid var(--dsw-alias-line-1,rgba(127,127,127,.3));",
					"  box-shadow:0 10px 30px rgba(0,0,0,.32);",
					"  font:12px/1.5 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}",
					PANEL_ATTR_ID + " .dsh-bt-row{display:flex;width:100%;align-items:center;gap:8px;padding:6px 8px;",
					"  border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;",
					"  text-align:left;font:inherit}",
					PANEL_ATTR_ID + " .dsh-bt-row:hover{background:rgba(127,127,127,.18)}",
					PANEL_ATTR_ID + " .dsh-bt-row[aria-pressed='true']{color:var(--dsw-alias-brand-primary,#4f8cff)}",
					PANEL_ATTR_ID + " .dsh-bt-name{flex:1 1 auto;white-space:nowrap}",
					PANEL_ATTR_ID + " .dsh-bt-value{flex:none;opacity:.72;font-variant-numeric:tabular-nums}",
					PANEL_ATTR_ID + " .dsh-bt-caret{flex:none;width:10px;opacity:.6;text-align:center}",
					".dsh-bt-sep{height:1px;margin:4px 2px;background:rgba(127,127,127,.24)}",
					".dsh-bt-err{padding:6px 8px;border-radius:6px;margin-bottom:2px;word-break:break-word;",
					"  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;",
					"  background:rgba(127,127,127,.1)}",
					".dsh-bt-err[data-lvl='error']{border-left:2px solid #e5484d}",
					".dsh-bt-err[data-lvl='warning']{border-left:2px solid #d99a2b}",
					".dsh-bt-empty{padding:12px 8px;opacity:.6;text-align:center}"
				].join("\n");
				document.head.appendChild(style);
			}

			function applyZoom(webview, percent) {
				try {
					if (webview && typeof webview.setZoomFactor === "function") {
						webview.setZoomFactor(percent / 100);
						return true;
					}
					if (webview && typeof webview.setZoomLevel === "function") {
						webview.setZoomLevel(Math.log(percent / 100) / Math.log(1.2));
						return true;
					}
				} catch {}
				return false;
			}

			function applyWidth(webview, preset) {
				if (!webview || !webview.style) return;
				const style = webview.style;
				const names = ["width", "min-width", "max-width", "margin", "flex", "box-shadow"];
				if (preset.width === 0) {
					for (const name of names) style.removeProperty(name);
					return;
				}
				style.setProperty("width", preset.width + "px", "important");
				style.setProperty("min-width", preset.width + "px", "important");
				style.setProperty("max-width", preset.width + "px", "important");
				style.setProperty("margin", "0 auto", "important");
				style.setProperty("flex", "0 0 auto", "important");
				style.setProperty("box-shadow", "0 0 0 1px var(--dsw-alias-line-1,rgba(127,127,127,.4))", "important");
			}

			function presetOf(state) {
				return WIDTHS.find((item) => item.id === state.width) || WIDTHS[0];
			}

			function normalizeLevel(event) {
				const raw = event && event.level;
				if (typeof raw === "string") {
					if (raw === "error") return "error";
					if (raw === "warning" || raw === "warn") return "warning";
					return "info";
				}
				if (raw === 3) return "error";
				if (raw === 2) return "warning";
				return "info";
			}

			function hookConsole(webview, state) {
				if (hooked.has(webview)) return;
				hooked.add(webview);
				const push = (level, message) => {
					const text = String(message === undefined || message === null ? "" : message);
					state.errors.push({ level: level, message: text.replace(/\s+$/u, "").slice(0, 500), at: Date.now() });
					if (state.errors.length > 200) state.errors.splice(0, state.errors.length - 200);
				};
				try {
					webview.addEventListener("console-message", (event) => {
						const level = normalizeLevel(event);
						if (level === "info") return;
						push(level, event && event.message);
					});
				} catch {}
				try {
					webview.addEventListener("did-fail-load", (event) => {
						if (event && event.errorCode === -3) return;
						const description = event && event.errorDescription ? " " + event.errorDescription : "";
						const url = event && event.validatedURL ? " - " + event.validatedURL : "";
						push("error", "加载失败 (" + ((event && event.errorCode) || "?") + ")" + description + url);
					});
				} catch {}
				try {
					webview.addEventListener("crashed", () => push("error", "页面渲染进程崩溃"));
				} catch {}
				try {
					webview.addEventListener("did-navigate", () => {
						state.errors.length = 0;
						closePanels(state);
					});
				} catch {}
			}

			function closePanels(state) {
				if (!state) return;
				if (state.sub) {
					state.sub.remove();
					state.sub = null;
				}
				if (state.panel) {
					state.panel.remove();
					state.panel = null;
				}
				state.kind = null;
				state.subKind = null;
				refreshBar(state.bar);
			}

			function place(panel, anchor, side) {
				const rect = anchor.getBoundingClientRect();
				const width = panel.offsetWidth;
				const height = panel.offsetHeight;
				let left = rect.left;
				let top = rect.bottom + 4;
				if (side === "right") {
					left = rect.right + 4;
					top = rect.top;
					if (left + width > window.innerWidth - 8) left = Math.max(8, rect.left - width - 4);
				} else if (left + width > window.innerWidth - 8) {
					left = Math.max(8, window.innerWidth - width - 8);
				}
				if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
				panel.style.left = Math.round(left) + "px";
				panel.style.top = Math.round(Math.max(8, top)) + "px";
			}

			function panelEl() {
				const panel = document.createElement("div");
				panel.setAttribute(PANEL_ATTR, "");
				panel.style.visibility = "hidden";
				return panel;
			}

			function row(label, value, caret) {
				const item = document.createElement("button");
				item.type = "button";
				item.className = "dsh-bt-row";
				const name = document.createElement("span");
				name.className = "dsh-bt-name";
				name.textContent = label;
				item.appendChild(name);
				if (value !== void 0 && value !== "") {
					const shown = document.createElement("span");
					shown.className = "dsh-bt-value";
					shown.textContent = value;
					item.appendChild(shown);
				}
				if (caret === true) {
					const mark = document.createElement("span");
					mark.className = "dsh-bt-caret";
					mark.textContent = "›";
					item.appendChild(mark);
				}
				return item;
			}

			function fillZoom(panel, webview, state) {
				for (const percent of ZOOMS) {
					const item = row(percent + "%", "", false);
					item.setAttribute("aria-pressed", percent === state.zoom ? "true" : "false");
					item.addEventListener("click", () => {
						state.zoom = percent;
						applyZoom(webview, percent);
						closePanels(state);
					});
					panel.appendChild(item);
				}
				const sep = document.createElement("div");
				sep.className = "dsh-bt-sep";
				panel.appendChild(sep);
				const reset = row("重置为 100%", "", false);
				reset.addEventListener("click", () => {
					state.zoom = 100;
					applyZoom(webview, 100);
					closePanels(state);
				});
				panel.appendChild(reset);
			}

			function fillViewport(panel, webview, state) {
				for (const preset of WIDTHS) {
					const item = row(preset.label, preset.hint, false);
					item.setAttribute("aria-pressed", preset.id === state.width ? "true" : "false");
					item.addEventListener("click", () => {
						state.width = preset.id;
						applyWidth(webview, preset);
						closePanels(state);
					});
					panel.appendChild(item);
				}
			}

			function fillErrors(panel, webview, state) {
				if (state.errors.length === 0) {
					const empty = document.createElement("div");
					empty.className = "dsh-bt-empty";
					empty.textContent = "没有控制台报错";
					panel.appendChild(empty);
					return;
				}
				for (const entry of state.errors.slice().reverse()) {
					const line = document.createElement("div");
					line.className = "dsh-bt-err";
					line.dataset.lvl = entry.level;
					line.textContent = (entry.level === "warning" ? "[warn] " : "[error] ") + (entry.message === "" ? "(空消息)" : entry.message);
					panel.appendChild(line);
				}
				const sep = document.createElement("div");
				sep.className = "dsh-bt-sep";
				panel.appendChild(sep);
				const clear = row("清空", "", false);
				clear.addEventListener("click", () => {
					state.errors.length = 0;
					closePanels(state);
				});
				panel.appendChild(clear);
			}

			function openSub(bar, state, anchor, kind) {
				if (state.sub) {
					state.sub.remove();
					state.sub = null;
				}
				if (state.subKind === kind) {
					state.subKind = null;
					return;
				}
				state.subKind = kind;
				const panel = panelEl();
				const webview = bar.__wv;
				if (kind === "zoom") fillZoom(panel, webview, state);
				else if (kind === "viewport") fillViewport(panel, webview, state);
				else fillErrors(panel, webview, state);
				document.body.appendChild(panel);
				place(panel, anchor, "right");
				panel.style.visibility = "visible";
				state.sub = panel;
			}

			function findExternalButton(toolbar) {
				if (!toolbar) return null;
				const buttons = Array.from(toolbar.querySelectorAll("button"));
				for (const button of buttons) {
					if (button.closest(BAR_SEL) !== null) continue;
					const label = (button.getAttribute("aria-label") || "") + " " + (button.getAttribute("title") || "") + " " + (button.textContent || "");
					if (EXTERNAL_RE.test(label)) return button;
				}
				return null;
			}

			function labelsOf(toolbar) {
				if (!toolbar) return [];
				return Array.from(toolbar.querySelectorAll("button"))
					.filter((button) => button.closest(BAR_SEL) === null)
					.map((button) => (button.getAttribute("aria-label") || button.getAttribute("title") || button.textContent || "").trim().slice(0, 40))
					.filter((label) => label !== "");
			}

			function syncExternal(state) {
				const target = findExternalButton(state.toolbar);
				if (target === null || hidden.has(target)) return;
				hidden.set(target, target.style.display);
				target.style.display = "none";
			}

			function restoreExternal() {
				for (const entry of Array.from(hidden)) {
					try {
						entry[0].style.display = entry[1];
					} catch {}
				}
				hidden.clear();
			}

			function openExternal(url) {
				try {
					const opened = window.open(url, "_blank");
					if (opened) return;
				} catch {}
				try {
					window.navigator.clipboard.writeText(url);
				} catch {}
			}

			function openDevTools(webview) {
				try {
					if (webview && typeof webview.openDevTools === "function") webview.openDevTools();
				} catch {}
			}

			function toggleMenu(button, bar, state) {
				ensureStyle();
				if (state.panel !== null) {
					closePanels(state);
					return;
				}
				const webview = bar.__wv;
				const panel = panelEl();
				state.subKind = null;

				const zoomRow = row("缩放", state.zoom + "%", true);
				zoomRow.addEventListener("click", () => openSub(bar, state, zoomRow, "zoom"));
				panel.appendChild(zoomRow);

				const viewportRow = row("视口", presetOf(state).label, true);
				viewportRow.addEventListener("click", () => openSub(bar, state, viewportRow, "viewport"));
				panel.appendChild(viewportRow);

				const external = findExternalButton(state.toolbar);
				if (external !== null) {
					const externalRow = row("在系统浏览器中打开", "", false);
					externalRow.addEventListener("click", () => {
						closePanels(state);
						try {
							external.click();
						} catch {}
					});
					panel.appendChild(externalRow);
				}

				const devRow = row("打开开发者工具", "", false);
				devRow.addEventListener("click", () => {
					closePanels(state);
					openDevTools(webview);
				});
				panel.appendChild(devRow);

				if (state.errors.length > 0) {
					const errRow = row("控制台报错", String(state.errors.length), true);
					errRow.addEventListener("click", () => openSub(bar, state, errRow, "errors"));
					panel.appendChild(errRow);
				}

				const sep = document.createElement("div");
				sep.className = "dsh-bt-sep";
				panel.appendChild(sep);
				const repoRow = row("项目主页 · GitHub", "", false);
				repoRow.addEventListener("click", () => {
					closePanels(state);
					openExternal(REPO_URL);
				});
				panel.appendChild(repoRow);

				document.body.appendChild(panel);
				place(panel, button, "below");
				panel.style.visibility = "visible";
				state.panel = panel;
				state.kind = "menu";
				refreshBar(bar);
			}

			const MENU_ICON = "<svg width='16' height='16' viewBox='0 0 16 16' fill='currentColor' aria-hidden='true'><circle cx='8' cy='3' r='1.5'/><circle cx='8' cy='8' r='1.5'/><circle cx='8' cy='13' r='1.5'/></svg>";

			function buildBar(bar, webview) {
				const button = document.createElement("button");
				button.type = "button";
				button.title = "浏览器工具";
				button.setAttribute("aria-label", "浏览器工具");
				button.innerHTML = MENU_ICON;
				button.style.flex = "none";
				button.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					toggleMenu(button, bar, stateOf(bar.__wv));
				});
				bar.appendChild(button);
				bar.__ui = { button: button };
				bar.__ready = true;
				refreshBar(bar);
			}

			function refreshBar(bar) {
				if (!bar || bar.__ready !== true) return;
				const webview = bar.__wv;
				if (webview === void 0) return;
				const state = stateOf(webview);
				state.bar = bar;
				const ui = bar.__ui;
				const failing = state.errors.length > 0 ? "1" : "0";
				if (ui.button.dataset.btErr !== failing) ui.button.dataset.btErr = failing;
				const open = state.panel !== null ? "1" : "0";
				if (ui.button.dataset.btOpen !== open) ui.button.dataset.btOpen = open;
				const title = "浏览器工具 · " + state.zoom + "% · " + presetOf(state).label + (state.errors.length > 0 ? " · " + state.errors.length + " 条报错" : "");
				if (ui.button.title !== title) ui.button.title = title;
				if (ui.button.getAttribute("aria-label") !== title) ui.button.setAttribute("aria-label", title);
			}

			function ensureBar(toolbar, webview) {
				let bar = toolbar.querySelector(BAR_SEL);
				if (bar === null) {
					bar = document.createElement("div");
					bar.setAttribute(BAR_ATTR, "");
					bar.style.flex = "none";
					toolbar.appendChild(bar);
					bars.add(bar);
				}
				bar.__wv = webview;
				if (bar.__ready !== true) buildBar(bar, webview);
				refreshBar(bar);
				return bar;
			}

			function tick() {
				try {
					ensureStyle();
					for (const bar of Array.from(bars)) if (!bar.isConnected) bars.delete(bar);
					for (const webview of Array.from(document.querySelectorAll("webview"))) {
						if (!webview.isConnected) continue;
						const state = stateOf(webview);
						const toolbar = resolveToolbar(webview, state);
						if (toolbar === void 0) continue;
						hookConsole(webview, state);
						state.labels = labelsOf(toolbar);
						syncExternal(state);
						ensureBar(toolbar, webview);
					}
				} catch {}
			}

			function installDismissal() {
				const onPointerDown = (event) => {
					for (const bar of Array.from(bars)) {
						const state = stateOf(bar.__wv);
						if (state.panel === null) continue;
						if (state.panel.contains(event.target)) continue;
						if (state.sub && state.sub.contains(event.target)) continue;
						if (bar.contains(event.target)) continue;
						closePanels(state);
					}
				};
				const onKeyDown = (event) => {
					if (event.key !== "Escape") return;
					for (const bar of Array.from(bars)) closePanels(stateOf(bar.__wv));
				};
				const onResize = () => {
					for (const bar of Array.from(bars)) closePanels(stateOf(bar.__wv));
				};
				document.addEventListener("pointerdown", onPointerDown, true);
				document.addEventListener("keydown", onKeyDown, true);
				window.addEventListener("resize", onResize);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown, true);
					document.removeEventListener("keydown", onKeyDown, true);
					window.removeEventListener("resize", onResize);
				};
			}

			return function installToolbar(ctx) {
				ctx.effect(() => {
					const timer = window.setInterval(tick, TICK_MS);
					const dismiss = installDismissal();
					tick();
					let closed = false;
					const beat = () => {
						if (closed) return;
						try {
							const first = Array.from(bars)[0];
							const state = first ? stateOf(first.__wv) : void 0;
							const payload = JSON.stringify({
								version: VERSION,
								bars: bars.size,
								labels: state ? state.labels : [],
								external: state ? findExternalButton(state.toolbar) !== null : false
							});
							window.fetch(PING_URL, {
								method: "POST",
								headers: { "content-type": "application/json" },
								body: payload
							}).catch(() => {});
						} catch {}
					};
					beat();
					const heartbeat = window.setInterval(beat, 15000);
					window.__dshElementSourcePlus = { version: VERSION, tick: tick, bars: () => Array.from(bars) };
					return () => {
						closed = true;
						window.clearInterval(timer);
						window.clearInterval(heartbeat);
						dismiss();
						for (const bar of Array.from(bars)) {
							closePanels(stateOf(bar.__wv));
							bar.remove();
							bars.delete(bar);
						}
						restoreExternal();
						try {
							delete window.__dshElementSourcePlus;
						} catch {}
					};
				}, "dsh-element-source-plus: browser toolbar");
			};
		})();

		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map