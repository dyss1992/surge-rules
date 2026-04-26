// Surge HTTP request/response script.
// Rewrites Notion database view peek settings toward center peek.

(function () {
  const CENTER = "center_peek";
  const BODY_TYPES = new Set(["string", "object"]);

  function normalizeUrl(url) {
    if (typeof url !== "string") return { changed: false, value: url };
    try {
      const parsed = new URL(url);
      const pm = parsed.searchParams.get("pm");
      if (pm !== "s" && pm !== "f" && pm !== "side_peek" && pm !== "full_page") {
        return { changed: false, value: url };
      }
      parsed.searchParams.set("pm", "c");
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
    if (value.format.collection_peek_mode !== CENTER) {
      value.format.collection_peek_mode = CENTER;
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
      if (path === "format.collection_peek_mode" && operation.args !== CENTER) {
        operation.args = CENTER;
        changed = true;
      } else if (path === "format" && operation.args && typeof operation.args === "object") {
        if (operation.args.collection_peek_mode !== CENTER) {
          operation.args.collection_peek_mode = CENTER;
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
    let next = body
      .replace(/"collection_peek_mode"\s*:\s*"side_peek"/g, '"collection_peek_mode":"center_peek"')
      .replace(/"collection_peek_mode"\s*:\s*"full_page"/g, '"collection_peek_mode":"center_peek"');

    next = next.replace(/(let\s+[$A-Z_a-z][$\w]*\s*=\s*\{table:"side_peek"[^}]*\})/g, match =>
      match.replace(/:"side_peek"/g, ':"center_peek"'),
    );

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
