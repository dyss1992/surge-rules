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
  const JSON_BODY_LIMIT = 3 * 1024 * 1024;
  const ASSET_BODY_LIMIT = 4 * 1024 * 1024;
  const SMALL_NUMERIC_ASSET_BODY_LIMIT = 512 * 1024;
  const API_RESPONSE_PATTERN =
    /\/api\/v3\/(?:loadPageChunk|loadCachedPageChunkV2|queryCollection|syncRecordValues|syncRecordValuesSpaceInitial|getCollectionData|getRecordValues|getPublicPageData)(?:$|[/?#])/;
  const SAVE_TRANSACTIONS_PATTERN = /\/api\/v3\/saveTransactions(?:Fanout)?(?:$|[/?#])/;
  const ASSET_WHITELIST_PATTERN =
    /\/_assets\/(?:experimental\/)?(?:(?:61315|71688|67535|67426)-[A-Za-z0-9]+|(?:[A-Za-z0-9]*Relation[A-Za-z0-9]*|CollectionViewBlock|BlockPropertyRouter|peekRenderer|PagePropertiesRowNameMenu|RecordStore|formPropertyRenderer|RollupPropertyMenu|PropertyModulePersonProperty)-[A-Za-z0-9]+)\.js(?:$|[?#])/;
  const SMALL_NUMERIC_ASSET_PATTERN =
    /\/_assets\/(?:experimental\/)?(?!(?:61315|71688|67535|67426)-)[0-9]+-[A-Za-z0-9]+\.js(?:$|[?#])/;
  const RELATION_ASSET_PATTERN =
    /\/_assets\/(?:experimental\/)?[A-Za-z0-9]*Relation[A-Za-z0-9]*-[A-Za-z0-9]+\.js(?:$|[?#])/;
  const TEXT_SIGNAL_PATTERN =
    /collection_peek_mode|side_peek|center_peek|full_page|relation_property|peekViewBlockId|peekMode:|peekModeParam:|openInSidePeek|openInCenterPeek|[?&]pm=|pm:\s*["']/;

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

  function getHeader(headers, name) {
    if (!headers || typeof headers !== "object") return "";
    const target = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === target) {
        const value = headers[key];
        return value == null ? "" : String(value);
      }
    }
    return "";
  }

  function isCandidateJsonUrl(url) {
    return (
      typeof url === "string" &&
      (API_RESPONSE_PATTERN.test(url) || SAVE_TRANSACTIONS_PATTERN.test(url))
    );
  }

  function isWhitelistedAssetUrl(url) {
    return (
      typeof url === "string" &&
      (ASSET_WHITELIST_PATTERN.test(url) || SMALL_NUMERIC_ASSET_PATTERN.test(url))
    );
  }

  function getAssetBodyLimit(url) {
    if (
      typeof url === "string" &&
      SMALL_NUMERIC_ASSET_PATTERN.test(url) &&
      !ASSET_WHITELIST_PATTERN.test(url)
    ) {
      return SMALL_NUMERIC_ASSET_BODY_LIMIT;
    }
    return ASSET_BODY_LIMIT;
  }

  function isRelationAssetUrl(url) {
    return typeof url === "string" && RELATION_ASSET_PATTERN.test(url);
  }

  function shouldPatchJsonBody(body, url, headers) {
    if (typeof body !== "string") return false;
    if (!isCandidateJsonUrl(url)) return false;
    if (body.length > JSON_BODY_LIMIT) return false;

    const trimmed = body.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return false;

    const contentType = getHeader(headers, "content-type").toLowerCase();
    return !contentType || contentType.includes("json") || contentType.includes("text/plain");
  }

  function shouldPatchTextBody(body, url, headers) {
    if (typeof body !== "string") return false;
    if (!isWhitelistedAssetUrl(url)) return false;
    if (body.length > getAssetBodyLimit(url)) return false;

    const contentType = getHeader(headers, "content-type").toLowerCase();
    if (
      contentType &&
      !contentType.includes("javascript") &&
      !contentType.includes("ecmascript") &&
      !contentType.includes("text/plain") &&
      !contentType.includes("application/octet-stream")
    ) {
      return false;
    }

    return TEXT_SIGNAL_PATTERN.test(body);
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

    if (isCollectionView) {
      changed = patchCollectionViewValue(operation.args) || changed;
      changed =
        patchCollectionViewValue(operation.args && operation.args.value) ||
        changed;
    }

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

  function patchJsonBody(body, url, headers) {
    if (!shouldPatchJsonBody(body, url, headers)) return { changed: false, body };
    try {
      const parsed = JSON.parse(body);
      const changed = walk(parsed, "", null);
      return changed ? { changed: true, body: JSON.stringify(parsed) } : { changed: false, body };
    } catch {
      return { changed: false, body };
    }
  }

  function applyTextReplacements(text, replacements) {
    if (!replacements.length) return text;
    replacements.sort((a, b) => b.start - a.start);
    let next = text;
    for (const replacement of replacements) {
      next =
        next.slice(0, replacement.start) +
        replacement.value +
        next.slice(replacement.end);
    }
    return next;
  }

  function findBalancedEnd(text, startIndex, maxDistance) {
    let depth = 0;
    let quote = "";
    let escaped = false;
    const endIndex = Math.min(text.length, startIndex + maxDistance);

    for (let index = startIndex; index < endIndex; index += 1) {
      const char = text[index];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = "";
        }
        continue;
      }

      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }

    return -1;
  }

  function findExpressionEnd(text, startIndex, objectEnd) {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let quote = "";
    let escaped = false;

    for (let index = startIndex; index <= objectEnd; index += 1) {
      const char = text[index];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = "";
        }
        continue;
      }

      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
      } else if (char === "(") {
        parenDepth += 1;
      } else if (char === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (char === "[") {
        bracketDepth += 1;
      } else if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
      } else if (char === "{") {
        braceDepth += 1;
      } else if (char === "}") {
        if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return index;
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (
        char === "," &&
        parenDepth === 0 &&
        bracketDepth === 0 &&
        braceDepth === 0
      ) {
        return index;
      }
    }

    return -1;
  }

  function findMatchingParenEnd(text, openParenIndex, maxDistance) {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let quote = "";
    let escaped = false;
    const endIndex = Math.min(text.length, openParenIndex + maxDistance);

    for (let index = openParenIndex; index < endIndex; index += 1) {
      const char = text[index];

      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = "";
        }
        continue;
      }

      if (char === "\"" || char === "'" || char === "`") {
        quote = char;
      } else if (char === "(") {
        parenDepth += 1;
      } else if (char === ")") {
        parenDepth -= 1;
        if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return index;
      } else if (char === "[") {
        bracketDepth += 1;
      } else if (char === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
      } else if (char === "{") {
        braceDepth += 1;
      } else if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }

    return -1;
  }

  function isLikelyFunctionParameterObject(text, objectStart, objectEnd) {
    let openParenIndex = objectStart - 1;
    while (openParenIndex >= 0 && /\s/.test(text[openParenIndex])) openParenIndex -= 1;
    if (text[openParenIndex] !== "(") return false;

    const closeParenIndex = findMatchingParenEnd(text, openParenIndex, 5000);
    if (closeParenIndex === -1 || closeParenIndex < objectEnd) return false;

    let afterParenIndex = closeParenIndex + 1;
    while (afterParenIndex < text.length && /\s/.test(text[afterParenIndex])) afterParenIndex += 1;
    if (text[afterParenIndex] === "{" || text.slice(afterParenIndex, afterParenIndex + 2) === "=>") {
      return true;
    }

    const beforeParen = text.slice(Math.max(0, openParenIndex - 80), openParenIndex);
    return /\bfunction\s*[$A-Z_a-z][$\w]*\s*$/.test(beforeParen);
  }

  function isLikelyDestructuringPattern(text, objectEnd) {
    let afterIndex = objectEnd + 1;
    while (afterIndex < text.length && /\s/.test(text[afterIndex])) afterIndex += 1;
    return text[afterIndex] === "=" && text[afterIndex + 1] !== "=" && text[afterIndex + 1] !== ">";
  }

  function shouldSkipObjectRewrite(text, objectStart, objectEnd) {
    return (
      isLikelyFunctionParameterObject(text, objectStart, objectEnd) ||
      isLikelyDestructuringPattern(text, objectEnd)
    );
  }

  function patchPeekModeInObjects(text, options) {
    const replacements = [];
    let searchIndex = 0;

    while ((searchIndex = text.indexOf(options.startToken, searchIndex)) !== -1) {
      const objectEnd = findBalancedEnd(text, searchIndex, options.maxDistance || 1800);
      if (objectEnd === -1) {
        searchIndex += options.startToken.length;
        continue;
      }

      const objectText = text.slice(searchIndex, objectEnd + 1);
      if (options.requiredTokens.some(token => objectText.indexOf(token) === -1)) {
        searchIndex = objectEnd + 1;
        continue;
      }
      if (
        options.blockedTokens &&
        options.blockedTokens.some(token => objectText.indexOf(token) !== -1)
      ) {
        searchIndex = objectEnd + 1;
        continue;
      }
      if (shouldSkipObjectRewrite(text, searchIndex, objectEnd)) {
        searchIndex = objectEnd + 1;
        continue;
      }

      const propertyName = options.propertyName || "peekMode";
      const propertyToken = `${propertyName}:`;
      const peekIndex = objectText.indexOf(propertyToken);
      if (peekIndex !== -1) {
        const valueStart = searchIndex + peekIndex + propertyToken.length;
        const valueEnd = findExpressionEnd(text, valueStart, objectEnd);
        if (valueEnd !== -1) {
          const replacementValue = `"${options.mode}"`;
          if (text.slice(valueStart, valueEnd) !== replacementValue) {
            replacements.push({
              start: valueStart,
              end: valueEnd,
              value: replacementValue,
            });
          }
        }
      } else if (options.insertAfterToken) {
        const tokenIndex = objectText.indexOf(options.insertAfterToken);
        const valueStart = searchIndex + tokenIndex + options.insertAfterToken.length;
        const valueEnd = findExpressionEnd(text, valueStart, objectEnd);
        if (valueEnd !== -1) {
          replacements.push({
            start: valueEnd,
            end: valueEnd,
            value: `,${propertyToken}"${options.mode}"`,
          });
        }
      }

      searchIndex = objectEnd + 1;
    }

    return applyTextReplacements(text, replacements);
  }

  function patchExplicitOpenFlags(text, mode) {
    if (mode === "center_peek") {
      return text.replace(
        /\bopenIn(?:Side|Center)Peek\s*:\s*(?:!0|true)\b/g,
        "openInCenterPeek:!0",
      );
    }
    if (mode === "side_peek") {
      return text.replace(
        /\bopenIn(?:Side|Center)Peek\s*:\s*(?:!0|true)\b/g,
        "openInSidePeek:!0",
      );
    }
    return text.replace(
      /\b(openIn(?:Side|Center)Peek\s*:\s*)(?:!0|true)\b/g,
      "$1!1",
    );
  }

  function patchTextBody(body, url, headers) {
    if (!shouldPatchTextBody(body, url, headers)) return { changed: false, body };
    const openCallMode = isRelationAssetUrl(url) ? RELATION_PROPERTY_MODE : CLIENT_OPEN_MODE;
    const openCallPm = MODE_TO_PM[openCallMode] || URL_PM;
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
        (match, prefix, openInNewToken, offset, fullText) => {
          const objectStart = offset + match.indexOf("{");
          const objectEnd = findBalancedEnd(fullText, objectStart, 1200);
          if (objectEnd !== -1 && shouldSkipObjectRewrite(fullText, objectStart, objectEnd)) {
            return match;
          }
          return `${prefix}"${openCallMode}"${openInNewToken}`;
        },
      )
      .replace(new RegExp(`([?&]pm=)${PM_PATTERN}\\b`, "g"), `$1${URL_PM}`)
      .replace(new RegExp(`pm:\\s*["']${PM_PATTERN}["']`, "g"), `pm:"${URL_PM}"`)
      .replace(
        new RegExp(`peekModeParam:\\s*["']${PM_PATTERN}["']`, "g"),
        `peekModeParam:"${openCallPm}"`,
      )
      .replace(/\bpeekMode\s*:\s*["'](?:c|s|f)["']/g, `peekMode:"${openCallPm}"`);

    next = patchExplicitOpenFlags(next, openCallMode);

    next = patchPeekModeInObjects(next, {
      startToken: "{environment:",
      requiredTokens: ["store:", "peekMode:"],
      mode: openCallMode,
    });

    next = patchPeekModeInObjects(next, {
      startToken: "{environment:",
      requiredTokens: ["store:", "mainEditorCurrentBlockStore:", "peekCollectionData:"],
      insertAfterToken: "peekCollectionData:",
      propertyName: "overridePeekMode",
      blockedTokens: ["peekMode:"],
      mode: COLLECTION_VIEW_MODE,
    });

    if (isRelationAssetUrl(url)) {
      next = patchPeekModeInObjects(next, {
        startToken: "{pageId:",
        requiredTokens: ["peekViewBlockId:"],
        insertAfterToken: "peekViewBlockId:",
        mode: RELATION_PROPERTY_MODE,
      });
    }

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

  function getMessageHeaders(kind) {
    if (kind === "response" && typeof $response !== "undefined" && $response) {
      return $response.headers || {};
    }
    if (kind === "request" && typeof $request !== "undefined" && $request) {
      return $request.headers || {};
    }
    return {};
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
    const requestUrl =
      typeof $request !== "undefined" && $request ? $request.url : undefined;
    const headers = getMessageHeaders(bodyInfo.kind);
    const jsonResult = patchJsonBody(bodyInfo.body, requestUrl, headers);
    const bodyResult = jsonResult.changed
      ? jsonResult
      : patchTextBody(bodyInfo.body, requestUrl, headers);
    if (bodyResult.changed) {
      result.body = bodyResult.body;
      changed = true;
    }
  }

  $done(changed ? result : {});
})();
