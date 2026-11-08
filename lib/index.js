import { readFile, readdir, stat } from "node:fs/promises";
import { createUserMessage } from "@deepseek-ai/dsh-llm/message";
import { isAbsolute, join, relative, resolve } from "node:path";
//#region src/protocol.ts
/** Normalize whitespace runs and trim an element's text for search. */
function normalizeSearchText(value) {
	return value.replace(/\s+/g, " ").trim();
}
/** Sanitize a value that may come from an untrusted page into a plain string. */
function safeString(value, fallback = "") {
	return typeof value === "string" ? value : fallback;
}
/** Normalize an unknown `pick` payload into an ElementPick (or undefined). */
function pickFromUnknown(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const record = value;
	const element = record.element;
	if (typeof element !== "object" || element === null) return void 0;
	const el = element;
	const source = record.source;
	const framework = typeof record.framework === "string" ? record.framework : "generic";
	const classes = Array.isArray(el.classes) ? el.classes.filter((item) => typeof item === "string").slice(0, 16) : [];
	const attrs = Array.isArray(el.attrs) ? el.attrs.filter((item) => Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && typeof item[1] === "string").slice(0, 16) : [];
	const name = safeString(record.name);
	const sourceFile = typeof source === "object" && source !== null ? safeString(source.file) : "";
	return {
		protocolVersion: typeof record.protocolVersion === "number" ? record.protocolVersion : 0,
		framework,
		source: sourceFile === "" ? void 0 : {
			file: sourceFile,
			line: typeof source.line === "number" ? source.line : void 0,
			column: typeof source.column === "number" ? source.column : void 0
		},
		name: name === "" ? void 0 : name,
		element: {
			tag: safeString(el.tag, "div"),
			id: safeString(el.id) || void 0,
			classes,
			text: safeString(el.text) || void 0,
			selector: safeString(el.selector),
			attrs
		},
		pageUrl: safeString(record.pageUrl)
	};
}
//#endregion
//#region src/resolve.ts
/**
* Host-side source resolution: turn one page pick into a concrete
* `file[:line[:column]]` inside the session workspace.
*
* Sources of precision, in order:
*  1. The probe script already found exact metadata (code-inspector
*     `data-insp-*` attributes, React dev `__source`, Vue `__file`,
*     Svelte dev `__svelte_meta`). We normalize the reported path and
*     confine it to the workspace.
*  2. Otherwise a text search over the workspace source tree locates the
*     clicked text (Vue template text, JSX text nodes, …) and the line.
*  3. Otherwise a component-name search locates the component definition.
*
* Every resolved path MUST stay inside the session cwd; anything outside is
* refused so a malicious page cannot make the plugin read arbitrary files.
*/
const DEFAULT_SEARCH_EXTENSIONS = [
	"vue",
	"jsx",
	"tsx",
	"js",
	"ts",
	"mjs",
	"cjs",
	"svelte",
	"html",
	"htm",
	"css",
	"scss",
	"less",
	"styl"
];
/** Directories the fallback search never descends into. */
const SKIP_DIRS = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	".svn",
	".hg",
	"dist",
	"build",
	"out",
	"coverage",
	".next",
	".nuxt",
	".output",
	".svelte-kit",
	"target",
	"__pycache__",
	".cache"
]);
const SEARCH_CACHE = /* @__PURE__ */ new Map();
const SEARCH_CACHE_TTL_MS = 6e4;
const SEARCH_CACHE_MAX = 200;
/** Cache key of one search (cwd + the element search keys). */
function searchCacheKey(cwd, keys) {
	return `${cwd}\u0000${JSON.stringify([
		keys.text ?? "",
		keys.classes,
		keys.id ?? "",
		keys.name ?? ""
	])}`;
}
/** Store one search result, bounded and TTL-checked on read. */
function rememberSearch(key, hit) {
	if (SEARCH_CACHE.size >= SEARCH_CACHE_MAX) {
		const oldest = SEARCH_CACHE.keys().next().value;
		if (oldest !== void 0) SEARCH_CACHE.delete(oldest);
	}
	SEARCH_CACHE.set(key, {
		hit,
		at: Date.now()
	});
}
/** True when `target` equals `root` or sits below it. */
function isWithin(root, target) {
	const rel = relative(root, target);
	return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
}
/** The refusal message for a source outside the session workspace. */
function outsideWorkspaceMessage(file) {
	return `located file is outside the session workspace: ${file} —— 请把会话工作区切换到项目目录（如侧边栏选择项目文件夹）再试 / switch the session workspace to your project and retry`;
}
/** True when `raw` looks like a Windows drive path (with or without leading /). */
function isWindowsDrive(raw) {
	return /^(\/)?[A-Za-z]:[\\/]/.test(raw);
}
/** Strip a `file://` prefix and a leading slash in front of a Windows drive. */
function cleanUrlStyle(raw) {
	let out = raw;
	if (out.startsWith("file://")) out = out.slice(7);
	if (isWindowsDrive(out) && out.startsWith("/")) out = out.slice(1);
	return out;
}
/**
* Build the ordered candidate absolute paths for one reported source path.
* Webpack-style project-relative paths (`/src/App.vue`) join the cwd; Vite
* dev builds report absolute fs paths which pass through.
*/
function candidatePaths(raw, cwd, mappings) {
	let source = raw.trim();
	if (source === "") return [];
	for (const mapping of mappings ?? []) if (mapping.find !== "" && source.startsWith(mapping.find)) {
		source = mapping.replacement + source.slice(mapping.find.length);
		break;
	}
	source = cleanUrlStyle(source);
	const candidates = /* @__PURE__ */ new Set();
	if (isAbsolute(source) || isWindowsDrive(source)) candidates.add(cleanUrlStyle(source));
	candidates.add(join(cwd, source));
	candidates.add(resolve(cwd, source));
	return [...candidates].filter((candidate) => candidate !== "");
}
/** Read the 3-line window around `line` (1-based) as the snippet. */
async function readSnippet(file, line) {
	if (line === void 0 || line < 1) return void 0;
	try {
		const lines = (await readFile(file, "utf8")).split(/\r?\n/);
		const start = Math.max(0, line - 2);
		const end = Math.min(lines.length, line + 1);
		if (start >= end) return void 0;
		return lines.slice(start, end).join("\n");
	} catch {
		return;
	}
}
/** Whether a file exists on disk. */
async function fileExists(file) {
	try {
		return (await stat(file)).isFile();
	} catch {
		return false;
	}
}
/** Pick the first existing candidate; undefined when none exist. */
async function firstExisting(candidates) {
	for (const candidate of candidates) if (await fileExists(candidate)) return candidate;
}
const MIN_TEXT_LENGTH = 2;
/** Build the search keys for one pick. */
function searchKeysOf(pick) {
	const text = pick.element.text !== void 0 ? normalizeSearchText(pick.element.text) : void 0;
	return {
		text: text !== void 0 && Array.from(text).length >= MIN_TEXT_LENGTH ? text : void 0,
		classes: pick.element.classes.filter((cls) => cls.length >= 3),
		id: pick.element.id,
		name: pick.name !== void 0 && pick.name !== "" ? pick.name : void 0
	};
}
/** Framework-biased extension preference for the text search. */
function frameworkExtensions(framework) {
	switch (framework) {
		case "vue": return [
			"vue",
			"html",
			"js",
			"ts"
		];
		case "react": return [
			"jsx",
			"tsx",
			"js",
			"ts"
		];
		case "svelte": return [
			"svelte",
			"html",
			"js",
			"ts"
		];
		case "angular": return [
			"html",
			"ts",
			"scss",
			"css"
		];
		default: return;
	}
}
/** Escape a literal string for use inside a RegExp. */
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
* Depth-first text search over the workspace for the first source line that
* contains one of the keys. When a framework hint is given, a first pass
* scans only the framework's own file types (a Vue template hit beats a
* stray hit in a `.js` bundle), then a second pass covers every configured
* extension.
*/
async function searchWorkspace(cwd, keys, options) {
	const all = new Set(options.searchExtensions ?? DEFAULT_SEARCH_EXTENSIONS);
	const patterns = [];
	if (keys.text !== void 0) patterns.push({
		text: keys.text,
		kind: "text"
	});
	for (const cls of keys.classes) patterns.push({
		text: cls,
		kind: "class"
	});
	if (keys.id !== void 0) patterns.push({
		text: keys.id,
		kind: "id"
	});
	if (patterns.length === 0) return void 0;
	const cacheKey = searchCacheKey(cwd, keys);
	const cached = SEARCH_CACHE.get(cacheKey);
	if (cached !== void 0 && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) return cached.hit;
	const maxFiles = options.maxFiles ?? 3e3;
	const maxFileBytes = options.maxFileBytes ?? 262144;
	const maxDepth = options.maxDepth ?? 6;
	const deadline = Date.now() + (options.searchBudgetMs ?? 2500);
	const walk = async (extensions) => {
		let filesExamined = 0;
		const scan = async (dir, depth) => {
			if (depth > maxDepth || filesExamined >= maxFiles || Date.now() > deadline) return void 0;
			const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
			for (const entry of entries) {
				if (filesExamined >= maxFiles || Date.now() > deadline) return void 0;
				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					if (SKIP_DIRS.has(entry.name)) continue;
					const hit = await scan(full, depth + 1);
					if (hit !== void 0) return hit;
					continue;
				}
				if (!entry.isFile()) continue;
				const dot = entry.name.lastIndexOf(".");
				const ext = dot === -1 ? "" : entry.name.slice(dot + 1).toLowerCase();
				if (!extensions.has(ext)) continue;
				filesExamined += 1;
				const hit = await scanFile(full, patterns, maxFileBytes);
				if (hit !== void 0) return hit;
			}
		};
		return scan(cwd, 0);
	};
	const biased = frameworkExtensions(options.frameworkHint ?? "generic")?.filter((ext) => all.has(ext));
	const remember = (hit) => {
		rememberSearch(cacheKey, hit);
		return hit;
	};
	if (biased !== void 0 && biased.length > 0) {
		const first = await walk(new Set(biased));
		if (first !== void 0) return remember(first);
	}
	return remember(await walk(all));
}
/** Read one file (bounded) and return the first line containing a pattern. */
async function scanFile(file, patterns, maxFileBytes) {
	let content;
	try {
		if ((await stat(file)).size > maxFileBytes) return void 0;
		content = await readFile(file, "utf8");
	} catch {
		return;
	}
	const lines = content.split(/\r?\n/);
	const ordered = [...patterns].sort((a, b) => rankOf(a.kind) - rankOf(b.kind));
	for (const pattern of ordered) {
		const regex = new RegExp(escapeRegExp(pattern.text), "i");
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			if (regex.test(line)) return {
				file,
				line: index + 1,
				matched: line.trim()
			};
		}
	}
}
/** Search priority: exact text beats class/id beats component name. */
function rankOf(kind) {
	switch (kind) {
		case "text": return 0;
		case "class": return 1;
		case "id": return 2;
	}
}
/** Component-definition patterns searched when no text/class key matches. */
const COMPONENT_PATTERNS = [
	(name) => new RegExp(`\\b(?:export\\s+)?(?:default\\s+)?(?:function\\s+)?${escapeRegExp(name)}\\s*(?:<|\\(|\\{)`),
	(name) => new RegExp(`\\bconst\\s+${escapeRegExp(name)}\\s*=`),
	(name) => new RegExp(`\\bname\\s*:\\s*['"]${escapeRegExp(name)}['"]`)
];
/** Locate a component name's definition inside the workspace. */
async function searchComponent(cwd, name, options) {
	const extensions = new Set(options.searchExtensions ?? DEFAULT_SEARCH_EXTENSIONS);
	let filesExamined = 0;
	const maxFiles = options.maxFiles ?? 3e3;
	const maxFileBytes = options.maxFileBytes ?? 262144;
	const maxDepth = options.maxDepth ?? 6;
	const deadline = Date.now() + (options.searchBudgetMs ?? 2500);
	const patterns = COMPONENT_PATTERNS.map((make) => make(name));
	const walk = async (dir, depth) => {
		if (depth > maxDepth || filesExamined >= maxFiles || Date.now() > deadline) return void 0;
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (filesExamined >= maxFiles || Date.now() > deadline) return void 0;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				const hit = await walk(full, depth + 1);
				if (hit !== void 0) return hit;
				continue;
			}
			if (!entry.isFile()) continue;
			const dot = entry.name.lastIndexOf(".");
			const ext = dot === -1 ? "" : entry.name.slice(dot + 1).toLowerCase();
			if (!extensions.has(ext)) continue;
			filesExamined += 1;
			try {
				if ((await stat(full)).size > maxFileBytes) continue;
				const lines = (await readFile(full, "utf8")).split(/\r?\n/);
				for (const pattern of patterns) for (let index = 0; index < lines.length; index += 1) if (pattern.test(lines[index])) return {
					file: full,
					line: index + 1,
					matched: lines[index].trim()
				};
			} catch {}
		}
	};
	return walk(cwd, 0);
}
/**
* Resolve one pick to a workspace-confined source location.
* @returns ok:false with `error` when nothing was found or the reported path
* escaped the workspace.
*/
async function resolvePick(pick, options) {
	const cwd = options.cwd;
	if (pick.source !== void 0 && pick.source.file !== "") {
		const existing = await firstExisting(candidatePaths(pick.source.file, cwd, options.mappings));
		if (existing !== void 0) {
			if (!isWithin(cwd, existing)) return {
				ok: false,
				error: outsideWorkspaceMessage(existing)
			};
			let line = pick.source.line;
			if (line === void 0) line = (await locateLineInFile(existing, pick)).line;
			const method = methodFor(pick.framework, line !== void 0);
			const snippet = await readSnippet(existing, line);
			return {
				ok: true,
				file: existing,
				relative: relative(cwd, existing),
				line,
				column: pick.source.column,
				snippet,
				method,
				existed: true
			};
		}
	}
	const keys = searchKeysOf(pick);
	const hit = await searchWorkspace(cwd, keys, {
		...options,
		frameworkHint: pick.framework
	});
	if (hit !== void 0) {
		if (!isWithin(cwd, hit.file)) return {
			ok: false,
			error: outsideWorkspaceMessage(hit.file)
		};
		const snippet = await readSnippet(hit.file, hit.line);
		return {
			ok: true,
			file: hit.file,
			relative: relative(cwd, hit.file),
			line: hit.line,
			snippet,
			method: "text-search",
			existed: true
		};
	}
	if (keys.name !== void 0) {
		const componentHit = await searchComponent(cwd, keys.name, options);
		if (componentHit !== void 0) {
			if (!isWithin(cwd, componentHit.file)) return {
				ok: false,
				error: outsideWorkspaceMessage(componentHit.file)
			};
			const snippet = await readSnippet(componentHit.file, componentHit.line);
			return {
				ok: true,
				file: componentHit.file,
				relative: relative(cwd, componentHit.file),
				line: componentHit.line,
				snippet,
				method: "component-search",
				existed: true
			};
		}
	}
	return {
		ok: false,
		error: "could not locate source: no file, text, class, or component name matched"
	};
}
/** The resolve method label for a precise framework source. */
function methodFor(framework, hasLine) {
	switch (framework) {
		case "code-inspector": return "code-inspector";
		case "react": return hasLine ? "react-source" : "component-search";
		case "vue": return "vue-file";
		case "svelte": return hasLine ? "svelte-source" : "component-search";
		default: return "component-search";
	}
}
/**
* Locate the line of an element within ONE already-known file (Vue `__file`
* reports the file but not the line): scan for the clicked text, then class
* names, then the id — first match wins.
*/
async function locateLineInFile(file, pick, maxFileBytes = 524288) {
	const keys = searchKeysOf(pick);
	const patterns = [];
	if (keys.text !== void 0) patterns.push(keys.text);
	patterns.push(...keys.classes);
	if (keys.id !== void 0) patterns.push(keys.id);
	if (patterns.length === 0) return {};
	try {
		if ((await stat(file)).size > maxFileBytes) return {};
		const lines = (await readFile(file, "utf8")).split(/\r?\n/);
		for (const pattern of patterns) {
			const regex = new RegExp(escapeRegExp(pattern), "i");
			for (let index = 0; index < lines.length; index += 1) if (regex.test(lines[index])) return { line: index + 1 };
		}
	} catch {}
	return {};
}
//#endregion
//#region src/steer.ts
/** A compact one-line element summary for the message. */
function elementSummary(element) {
	let label = element.tag;
	if (element.id !== void 0) label += `#${element.id}`;
	const classes = element.classes.slice(0, 2);
	if (classes.length > 0) label += `.${classes.join(".")}`;
	if (element.text !== void 0 && element.text !== "") label += `（文本："${element.text}"）`;
	return label;
}
const METHOD_LABELS = {
	"code-inspector": "code-inspector data-insp 属性",
	"react-source": "React dev __source",
	"vue-file": "Vue __file",
	"svelte-source": "Svelte dev __svelte_meta",
	"text-search": "工作区文本搜索",
	"component-search": "组件名搜索",
	none: "未知"
};
/**
* The steering message delivered to the session agent after a successful pick.
* Bilingual (zh/en) so the model can answer in the user's language.
*/
function buildSteerText(result, element, pageUrl) {
	const location = result.line !== void 0 ? `${result.relative}:${result.line}` : result.relative;
	const label = elementSummary(element);
	const method = METHOD_LABELS[result.method];
	const urlLine = pageUrl === void 0 || pageUrl === "" ? "" : `\n页面：${pageUrl}`;
	return [
		`[元素定位] 你在预览页面点击了元素 \`${label}\`。`,
		`源代码已定位：\`${location}\`（定位方式：${method}）。${urlLine}`,
		`请用 read 工具读取该文件${result.line !== void 0 ? `并定位到第 ${result.line} 行` : ""}，`,
		`在回复中用代码块展示相关源码，用一句话说明该元素渲染了什么，然后等待我的修改需求。`,
		``,
		`[Element located] You clicked \`${label}\` in the preview page.`,
		`Source: \`${location}\` (method: ${result.method}).`,
		`Read the file with the read tool${result.line !== void 0 ? ` and find line ${result.line}` : ""},`,
		`show the relevant code in a code block, explain in one sentence what the element renders, then wait for my change request.`
	].join("\n");
}
//#endregion
//#region src/trust-fence.ts
function header(headers, name) {
	const value = headers[name];
	return typeof value === "string" ? value : void 0;
}
/** Normalized URL of a Host-header authority, or undefined when unparsable. */
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/** Canonical authority form: hostname, or hostname:port when a port was written. */
function canonicalAuthority(entry, entryUrl) {
	const port = entryUrl.port !== "" ? entryUrl.port : new URL(`https://${entry}`).port;
	return port === "" ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
/** Whether the request authority matches a trustedHosts entry (exact or port-less). */
function isTrustedAuthority(hostUrl, trustedHosts) {
	return trustedHosts.some((entry) => {
		const entryUrl = parseAuthority(entry);
		if (entryUrl === void 0) return false;
		return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host;
	});
}
/**
* Decide whether one plugin request may reach the API routes.
* @param request - node HTTP request facts (headers).
* @param trustedHosts - non-loopback authorities this deployment serves.
* @returns true when the Host is ours (loopback or trusted) and browser markers are same-origin.
*/
function isTrustedApiRequest(request, trustedHosts) {
	const host = header(request.headers, "host");
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
	const origin = header(request.headers, "origin");
	if (origin === "dsh-app://app") return true;
	if (header(request.headers, "sec-fetch-site") === "cross-site") return false;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
//#endregion
//#region src/wire.ts
/** One API failure with its wire code and HTTP status. */
var ApiError = class extends Error {
	code;
	status;
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
};
/** Body size bound of one JSON request (defense against unbounded reads). */
const MAX_BODY_BYTES = 1 << 20;
/** Read and parse the JSON request body (bounded; malformed → bad-request). */
async function readJsonBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		total += buffer.length;
		if (total > MAX_BODY_BYTES) throw new ApiError("bad-request", "request body too large");
		chunks.push(buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim() === "") return {};
	try {
		return JSON.parse(text);
	} catch {
		throw new ApiError("bad-request", "request body is not valid JSON");
	}
}
/** Write a JSON response with the given status. */
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(payload);
}
//#endregion
//#region src/index.ts
/**
* dsh-element-source host half.
*
* Responsibilities:
*  - Serve the page probe script at GET /dsh-element-source/inject.js (public:
*    dev pages load it cross-origin; it is read-only code with no secrets).
*  - Queue picks at POST /dsh-element-source/api/pick. The DSH built-in
*    browser hosts the dev page in an isolated frame, so the probe reaches
*    this route over HTTP; the route is public and write-only (a bounded
*    queue, no response data).
*  - Resolve queued picks at GET /dsh-element-source/api/pending, behind the
*    browser-trust fence: the DSH chat client polls with its session, the host
*    resolves each pick inside the session workspace, and the client fills the
*    composer draft. When autoSteer is on the session agent is woken too.
*  - Contribute a system-prompt section teaching the agent how to present a
*    located source.
*/
/** Plugin identity for cordis.yml rows. */
const name = "dsh-element-source";
/** Hard dependencies: the webserver routes, the session store, the loader's connection row. */
const inject = [
	"webServer",
	"sessions",
	"loader"
];
/** The fixed route prefix of the plugin (host and client halves agree on it). */
const ROUTE_PREFIX = "/dsh-element-source";
const SYSTEM_PROMPT_SECTION = [
	"当收到来源为 dsh-element-source 的「[元素定位]」用户消息时：",
	"1. 用 read 工具读取消息中给出的文件路径（如带行号则读取该文件全部内容后定位到对应行）；",
	"2. 在回复中用代码块展示定位到的源码，用一句话说明该元素渲染了什么；",
	"3. 然后停止，等待用户提出修改需求，不要擅自大改代码。",
	"",
	"When you receive an \"[Element located]\" user message from dsh-element-source:",
	"1. read the file path given in the message with the read tool (and find the stated line when present);",
	"2. show the located code in a code block and explain in one sentence what the element renders;",
	"3. then stop and wait for the user's change request — do not make large edits on your own."
].join("\n");
/** CORS headers for the two public probe routes (a dev page fetches them cross-origin). */
const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-headers": "content-type"
};
/** Write a JSON response with CORS headers (public routes only). */
function writeCorsJson(res, status, body) {
	res.writeHead(status, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8"
	});
	res.end(JSON.stringify(body));
}
/** Bounded FIFO of picks waiting for the chat client's next poll. */
var PickQueue = class {
	items = [];
	seq = 0;
	/** Maximum queued picks; the oldest drop first (the newest picks matter). */
	limit = 32;
	/** Append one pick; returns its queue sequence. */
	push(pick) {
		this.seq += 1;
		this.items.push({
			seq: this.seq,
			pick
		});
		while (this.items.length > this.limit) this.items.shift();
		return this.seq;
	}
	/** Picks queued after `seq` (exclusive). */
	after(seq) {
		return this.items.filter((item) => item.seq > seq);
	}
	/** The newest sequence handed out (the client's next `after`). */
	sequence() {
		return this.seq;
	}
};
/** The connection row's resolved trustedHosts (live read; the /api fence's own list). */
function trustedHostsOf(ctx) {
	for (const entry of ctx.loader.entries()) if (entry.options.name === "connection") return entry.options.config?.trustedHosts ?? [];
	return [];
}
/** Resolve a session's authoritative working directory (header wins, then the caller's). */
function sessionCwdOf(ctx, sessionId, clientCwd) {
	const headerCwd = ctx.sessions.get(sessionId)?.header.cwd;
	if (headerCwd !== void 0 && headerCwd !== "") return headerCwd;
	if (clientCwd !== void 0 && clientCwd !== "") return clientCwd;
	return process.cwd();
}
/** Clamp a poll watermark to a non-negative integer. */
function clampAfter(value) {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
/**
* Plugin body.
* @param ctx - host plugin context (webServer, sessions, loader).
* @param config - optional deployment-provided configuration.
*/
function applyBase(ctx, config) {
	const resolved = {
		autoSteer: config?.autoSteer ?? false,
		...config
	};
	const fence = (req) => isTrustedApiRequest(req, trustedHostsOf(ctx));
	const queue = new PickQueue();
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: ROUTE_PREFIX,
		handler: async (req, res) => {
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			if (pathname === `${ROUTE_PREFIX}/inject.js` && (req.method === "GET" || req.method === "HEAD")) {
				try {
					const script = await readFile(new URL("../lib/inject.js", import.meta.url));
					res.writeHead(200, {
						"content-type": "application/javascript; charset=utf-8",
						"cache-control": "no-store",
						"access-control-allow-origin": "*"
					});
					res.end(req.method === "HEAD" ? void 0 : script);
				} catch {
					res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
					res.end("dsh-element-source: inject.js not built (run pnpm build)");
				}
				return;
			}
			if (pathname === `${ROUTE_PREFIX}/api/pick`) {
				await handlePick(queue, req, res);
				return;
			}
			if (pathname === `${ROUTE_PREFIX}/api/pending`) {
				await handlePending(ctx, resolved, queue, fence, req, res);
				return;
			}
			writeJson(res, 404, {
				ok: false,
				error: {
					code: "not-found",
					message: `unknown route ${pathname}`
				}
			});
		}
	}), "dsh-element-source: routes");
	const systemPrompt = ctx.get("systemPrompt");
	if (systemPrompt !== void 0) ctx.effect(() => systemPrompt.section({
		name: "dsh-element-source",
		order: 60,
		text: SYSTEM_PROMPT_SECTION
	}), "dsh-element-source: system prompt section");
}
/** Accept one pick from any page and queue it (write-only; never returns pick data). */
async function handlePick(queue, req, res) {
	if (req.method === "OPTIONS") {
		res.writeHead(204, CORS_HEADERS);
		res.end();
		return;
	}
	if (req.method !== "POST") {
		writeCorsJson(res, 405, {
			ok: false,
			error: {
				code: "method-error",
				message: "method not allowed"
			}
		});
		return;
	}
	try {
		const pick = pickFromUnknown(await readJsonBody(req));
		if (pick === void 0) {
			writeCorsJson(res, 400, {
				ok: false,
				error: {
					code: "bad-request",
					message: "invalid pick payload"
				}
			});
			return;
		}
		queue.push(pick);
		res.writeHead(204, CORS_HEADERS);
		res.end();
	} catch (error) {
		writeCorsJson(res, error instanceof ApiError ? error.status : 400, {
			ok: false,
			error: {
				code: "bad-request",
				message: error instanceof Error ? error.message : "bad request"
			}
		});
	}
}
/** Drain and resolve the picks queued after the caller's watermark. */
async function handlePending(ctx, config, queue, fence, req, res) {
	if (req.method === "OPTIONS") {
		res.writeHead(204, CORS_HEADERS);
		res.end();
		return;
	}
	if (req.method !== "GET") {
		writeCorsJson(res, 405, {
			ok: false,
			error: {
				code: "method-error",
				message: "method not allowed"
			}
		});
		return;
	}
	if (!fence(req)) {
		writeCorsJson(res, 403, {
			ok: false,
			error: {
				code: "forbidden",
				message: "forbidden"
			}
		});
		return;
	}
	const url = new URL(req.url ?? "/", "http://dsh.internal");
	const found = sessionById(ctx, config.sessionId ?? url.searchParams.get("sessionId") ?? "");
	if (found === void 0) {
		writeCorsJson(res, 404, {
			ok: false,
			error: {
				code: "not-found",
				message: "unknown session"
			}
		});
		return;
	}
	const sessionId = found.id;
	const cwd = sessionCwdOf(ctx, sessionId, url.searchParams.get("cwd") ?? void 0);
	const after = clampAfter(Number(url.searchParams.get("after") ?? "0"));
	const results = [];
	for (const entry of queue.after(after)) {
		const located = await resolvePick(entry.pick, {
			cwd,
			mappings: config.mappings,
			frameworkHint: entry.pick.framework
		});
		if ("error" in located) {
			results.push({
				seq: entry.seq,
				ok: false,
				error: located.error,
				framework: entry.pick.framework
			});
			continue;
		}
		results.push({
			seq: entry.seq,
			ok: true,
			relative: located.relative,
			line: located.line,
			column: located.column,
			snippet: located.snippet,
			method: located.method,
			framework: entry.pick.framework
		});
		await maybeSteer(ctx, config.autoSteer, entry.pick, sessionId, located);
	}
	writeCorsJson(res, 200, {
		ok: true,
		value: {
			sequence: queue.sequence(),
			results
		}
	});
}
/** Resolve a session by id, tolerating the bare-uuid form (`session-<uuid>` is canonical). */
function sessionById(ctx, raw) {
	if (raw === "") return void 0;
	const direct = ctx.sessions.get(raw);
	if (direct !== void 0) return {
		id: raw,
		session: direct
	};
	const alternate = raw.startsWith("session-") ? raw.slice(8) : `session-${raw}`;
	const alt = ctx.sessions.get(alternate);
	return alt === void 0 ? void 0 : {
		id: alternate,
		session: alt
	};
}
/** Deliver the steering message when enabled and the session's agent is live. */
async function maybeSteer(ctx, autoSteer, pick, sessionId, located) {
	if (!autoSteer) return false;
	const agents = ctx.get("agents");
	if (agents === void 0) return false;
	const agent = agents.get(sessionId);
	if (agent === void 0) return false;
	const message = createUserMessage({
		content: [{
			type: "text",
			text: buildSteerText(located, pick.element, pick.pageUrl)
		}],
		source: {
			kind: "plugin",
			plugin: "dsh-element-source"
		}
	});
	agent.steer(message);
	return true;
}
/* ---------------------- merged-plugin probe route ---------------------- */
const PROBE_PREFIX = "/dsh-element-source-plus";
const PROBE_STATE = { mountedAt: 0, beats: 0, version: "", bars: 0, labels: [], external: false, lastBeat: 0 };
function probeJson(res, status, body) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(JSON.stringify(body));
}
function probeReadBody(req) {
	return new Promise((resolve) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
			if (raw.length > 8192) req.destroy();
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(raw || "{}"));
			} catch {
				resolve({});
			}
		});
		req.on("error", () => resolve({}));
	});
}
function installProbe(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: PROBE_PREFIX,
		handler: async (req, res) => {
			const pathname = new URL(req.url ?? "/", "http://dsh.internal").pathname;
			if (pathname === PROBE_PREFIX + "/api/ping" && req.method === "POST") {
				const body = await probeReadBody(req);
				const now = Date.now();
				if (PROBE_STATE.mountedAt === 0) PROBE_STATE.mountedAt = now;
				PROBE_STATE.beats += 1;
				PROBE_STATE.lastBeat = now;
				if (typeof body.version === "string") PROBE_STATE.version = body.version;
				if (typeof body.bars === "number") PROBE_STATE.bars = body.bars;
				if (Array.isArray(body.labels)) PROBE_STATE.labels = body.labels.slice(0, 12);
				if (typeof body.external === "boolean") PROBE_STATE.external = body.external;
				probeJson(res, 200, { ok: true });
				return;
			}
			if (pathname === PROBE_PREFIX + "/api/status") {
				probeJson(res, 200, { ok: true, value: { ...PROBE_STATE, now: Date.now() } });
				return;
			}
			probeJson(res, 404, { ok: false, error: { code: "not-found" } });
		}
	}), "dsh-element-source-plus: probe route");
}
/** Merged plugin entry: the element-source host plus the probe route. */
function apply(ctx, config) {
	applyBase(ctx, config);
	installProbe(ctx);
}
//#endregion
export { apply, inject, name };
