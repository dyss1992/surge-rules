// Surge HTTP request/response script.
// Rewrites Notion database view peek settings toward the configured peek mode.

(function () {
  const DEFAULT_MODE = "center_peek";
  const MODE_TO_PM = {
    center_peek: "c",
    side_peek: "s",
    full_page: "f",
  };
  const PM_TO_MODE = {
    c: "center_peek",
    s: "side_peek",
    f: "full_page",
  };
  const MODE_PATTERN = "(?:center_peek|side_peek|full_page)";
  const PM_PATTERN = "(?:c|s|f|center_peek|side_peek|full_page)";
  const BODY_TYPES = new Set(["string", "object"]);

  function decodeArg(value) {
    try {
      return decodeURIComponent(String(value).replace(/\+/g, " "));
    } catch {
      return String(value);
    }
  }

  function parseArguments(raw) {
    const parsed = {};
    if (typeof raw !== "string" || raw.trim() === "") return parsed;
    for (const part of raw.split(/[&;]/)) {
      if (!part) continue;
      const index = part.indexOf("=");
      const key = decodeArg(index === -1 ? part : part.slice(0, index)).trim();
      const value = decodeArg(index === -1 ? "" : part.slice(index + 1)).trim();
      if (key) parsed[key] = value;
    }
    return parsed;
  }

  function normalizePeekMode(value, fallback) {
    if (typeof value !== "string" || value.trim() === "") return fallback;
    const mode = value.trim();
    if (Object.prototype.hasOwnProperty.call(MODE_TO_PM, mode)) return mode;
    if (Object.prototype.hasOwnProperty.call(PM_TO_MODE, mode)) return PM_TO_MODE[mode];
    return fallback;
  }

  function resolveMode(args, key, fallback) {
    const raw = args[key];
    if (raw === "target" || raw === "auto") return fallback;
    return normalizePeekMode(raw, fallback);
  }

  function resolvePm(args, key, fallbackMode) {
    const raw = args[key];
    if (typeof raw !== "string" || raw.trim() === "" || raw === "target" || raw === "auto") {
      return MODE_TO_PM[fallbackMode] || MODE_TO_PM[DEFAULT_MODE];
    }
    const value = raw.trim();
    if (Object.prototype.hasOwnProperty.call(PM_TO_MODE, value)) return value;
    const mode = normalizePeekMode(value, fallbackMode);
    return MODE_TO_PM[mode] || MODE_TO_PM[fallbackMode] || MODE_TO_PM[DEFAULT_MODE];
  }

  const args = parseArguments(typeof $argument === "string" ? $argument : "");
  const TARGET_MODE = normalizePeekMode(args.target_mode, DEFAULT_MODE);
  const COLLECTION_VIEW_MODE = resolveMode(args, "collection_view_mode", TARGET_MODE);
  const RELATION_PROPERTY_MODE = resolveMode(args, "relation_property_mode", TARGET_MODE);
  const FALLBACK_PEEK_MODE = resolveMode(args, "fallback_peek_mode", TARGET_MODE);
  const CLIENT_OPEN_MODE = resolveMode(args, "client_open_mode", TARGET_MODE);
  const URL_PM = resolvePm(args, "url_pm", TARGET_MODE);

  function normalizeUrl(url) {
    if (typeof url !== "string") return { changed: false, value: url };
    try {
      const parsed = new URL(url);
      const pm = parsed.searchParams.get("pm");
      const normalizedPm = Object.prototype.hasOwnProperty.call(PM_TO_MODE, pm)
        ? pm
        : MODE_TO_PM[normalizePeekMode(pm, "")];
      if (!normalizedPm || pm === URL_PM) {
        return { changed: false, value: url };
      }
      parsed.searchParams.set("pm", URL_PM);
      return { changed: parsed.toString() !== url, value: parsed.toString() };
    } catch {
      return { changed: false, value: url };
    }
  }

  function looksLikeCollectionViewValue(value) {
    return (
      value &&
      typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, "type") &&
      Object.prototype.hasOwnProperty.call(value, "format") &&
      (typeof value.type === "string" || value.type === null)
    );
  }

  function patchCollectionViewValue(value) {
    if (!looksLikeCollectionViewValue(value)) return false;
    if (!value.format || typeof value.format !== "object" || Array.isArray(value.format)) {
      value.format = {};
    }
    if (value.format.collection_peek_mode !== COLLECTION_VIEW_MODE) {
      value.format.collection_peek_mode = COLLECTION_VIEW_MODE;
      return true;
    }
    return false;
  }

  function patchRecordMapCollectionViews(root) {
    let changed = false;
    const collectionViews =
      root &&
      typeof root === "object" &&
      root.recordMap &&
      root.recordMap.collection_view;

    if (!collectionViews || typeof collectionViews !== "object") return false;
    for (const id of Object.keys(collectionViews)) {
      const record = collectionViews[id];
      if (record && typeof record === "object") {
        changed = patchCollectionViewValue(record.value) || changed;
      }
    }
    return changed;
  }

  function patchCollectionViewMap(value) {
    let changed = false;
    if (!value || typeof value !== "object") return false;
    for (const id of Object.keys(value)) {
      const record = value[id];
      if (!record || typeof record !== "object") continue;
      changed = patchCollectionViewValue(record.value) || changed;
      changed = patchCollectionViewValue(record) || changed;
    }
    return changed;
  }

  function patchOperation(operation) {
    if (!operation || typeof operation !== "object") return false;
    let changed = false;
    const pointer = operation.pointer;
    const isCollectionView =
      pointer &&
      typeof pointer === "object" &&
      (pointer.table === "collection_view" || pointer.table === "collection_view_v2");

    if (isCollectionView && Array.isArray(operation.path)) {
      const path = operation.path.join(".");
      if (path === "format.collection_peek_mode" && operation.args !== COLLECTION_VIEW_MODE) {
        operation.args = COLLECTION_VIEW_MODE;
        changed = true;
      } else if (path === "format" && operation.args && typeof operation.args === "object") {
        if (operation.args.collection_peek_mode !== COLLECTION_VIEW_MODE) {
          operation.args.collection_peek_mode = COLLECTION_VIEW_MODE;
          changed = true;
        }
      }
    }

    return changed;
  }

  function walk(value, key, parent) {
    let changed = false;

    if (!value || typeof value !== "object") return false;

    if (key === "collection_view") {
      changed = patchCollectionViewMap(value) || changed;
    }

    changed = patchOperation(value) || changed;
    changed = patchRecordMapCollectionViews(value) || changed;

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        changed = walk(value[index], String(index), value) || changed;
      }
    } else {
      for (const childKey of Object.keys(value)) {
        changed = walk(value[childKey], childKey, value) || changed;
      }
    }

    return changed;
  }

  function patchJsonBody(body) {
    if (typeof body !== "string") return { changed: false, body };
    const trimmed = body.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
      return { changed: false, body };
    }

    try {
      const parsed = JSON.parse(body);
      const changed = walk(parsed, "", null);
      return changed ? { changed: true, body: JSON.stringify(parsed) } : { changed: false, body };
    } catch {
      return { changed: false, body };
    }
  }

  function isAssetUrl(url) {
    return typeof url === "string" && /\/_assets\//.test(url);
  }

  function patchTextBody(body, url) {
    if (typeof body !== "string") return { changed: false, body };
    if (!isAssetUrl(url)) return { changed: false, body };
    const modeRegex = new RegExp(`"collection_peek_mode"\\s*:\\s*"${MODE_PATTERN}"`, "g");
    let next = body.replace(
      modeRegex,
      `"collection_peek_mode":"${COLLECTION_VIEW_MODE}"`,
    );

    next = next.replace(
      new RegExp(`(let\\s+[$A-Z_a-z][$\\w]*\\s*=\\s*\\{table:"${MODE_PATTERN}"[^}]*\\})`, "g"),
      match => match.replace(new RegExp(`:"${MODE_PATTERN}"`, "g"), `:"${COLLECTION_VIEW_MODE}"`),
    );

    next = next
      .replace(
        new RegExp(`(\\?\\?\\([^;{}]{0,180}:"${MODE_PATTERN}"\\))`, "g"),
        match => match.replace(new RegExp(`:"${MODE_PATTERN}"`), `:"${FALLBACK_PEEK_MODE}"`),
      )
      .replace(
        new RegExp(`(from:\\s*"relation_property"\\s*,\\s*peekMode:\\s*)"${MODE_PATTERN}"`, "g"),
        `$1"${RELATION_PROPERTY_MODE}"`,
      )
      .replace(
        /((?:\)|[$A-Z_a-z][$\w]*)\s*\(\s*\{environment:[^{};]{0,500}?store:[^{};]{0,500}?peekMode:)[$A-Z_a-z][$\w]*(,openInNew)/g,
        `$1"${CLIENT_OPEN_MODE}"$2`,
      )
      .replace(new RegExp(`([?&]pm=)${PM_PATTERN}\\b`, "g"), `$1${URL_PM}`)
      .replace(new RegExp(`pm:\\s*["']${PM_PATTERN}["']`, "g"), `pm:"${URL_PM}"`);

    return { changed: next !== body, body: next };
  }

  function getBody() {
    if (typeof $response !== "undefined" && $response && BODY_TYPES.has(typeof $response.body)) {
      return { kind: "response", body: $response.body };
    }
    if (typeof $request !== "undefined" && $request && BODY_TYPES.has(typeof $request.body)) {
      return { kind: "request", body: $request.body };
    }
    return { kind: "none", body: undefined };
  }

  const result = {};
  let changed = false;

  if (typeof $request !== "undefined" && $request && $request.url) {
    const urlResult = normalizeUrl($request.url);
    if (urlResult.changed) {
      result.url = urlResult.value;
      changed = true;
    }
  }

  const bodyInfo = getBody();
  if (bodyInfo.kind !== "none") {
    const jsonResult = patchJsonBody(bodyInfo.body);
    const requestUrl =
      typeof $request !== "undefined" && $request ? $request.url : undefined;
    const bodyResult = jsonResult.changed
      ? jsonResult
      : patchTextBody(bodyInfo.body, requestUrl);
    if (bodyResult.changed) {
      result.body = bodyResult.body;
      changed = true;
    }
  }

  $done(changed ? result : {});
})();
