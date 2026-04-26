#!/usr/bin/env node

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const scriptPath = path.join(__dirname, "..", "scripts", "notion-center-peek.js");
const source = fs.readFileSync(scriptPath, "utf8");
const modulePath = path.join(__dirname, "..", "modules", "notion-center-peek.sgmodule");
const moduleSource = fs.readFileSync(modulePath, "utf8");

function runSurgeScript({ request, response }) {
  let doneValue;
  const context = {
    URL,
    Set,
    JSON,
    Object,
    Array,
    console,
    $request: request,
    $done(value) {
      doneValue = value || {};
    },
  };
  if (response) {
    context.$response = response;
  }
  vm.createContext(context);
  vm.runInContext(source, context, { filename: scriptPath });
  return doneValue;
}

const loadPageResponse = {
  recordMap: {
    collection_view: {
      a: {
        role: "editor",
        value: {
          id: "a",
          type: "table",
          format: { table_wrap: true, collection_peek_mode: "side_peek" },
        },
      },
      b: {
        role: "reader",
        value: {
          id: "b",
          type: "board",
          format: { board_columns: [] },
        },
      },
      c: {
        role: "reader",
        value: {
          id: "c",
          type: "calendar",
          format: { collection_peek_mode: "center_peek" },
        },
      },
    },
  },
};

const responseResult = runSurgeScript({
  request: { url: "https://www.notion.so/api/v3/loadPageChunk", method: "POST" },
  response: { status: 200, headers: {}, body: JSON.stringify(loadPageResponse) },
});
assert(responseResult.body, "response body should be changed");
const patchedResponse = JSON.parse(responseResult.body);
assert.equal(
  patchedResponse.recordMap.collection_view.a.value.format.collection_peek_mode,
  "center_peek",
);
assert.equal(
  patchedResponse.recordMap.collection_view.b.value.format.collection_peek_mode,
  "center_peek",
);
assert.equal(
  patchedResponse.recordMap.collection_view.c.value.format.collection_peek_mode,
  "center_peek",
);

const unrelatedRecordMapResponse = {
  recordMap: {
    block: {
      x: {
        role: "reader",
        value: {
          id: "x",
          type: "text",
          format: { block_color: "default", collection_peek_mode: "side_peek" },
        },
      },
    },
  },
};

const unrelatedResult = runSurgeScript({
  request: { url: "https://www.notion.so/api/v3/getActiveThreadsForBlocks", method: "POST" },
  response: { status: 200, headers: {}, body: JSON.stringify(unrelatedRecordMapResponse) },
});
assert.deepEqual(unrelatedResult, {}, "unrelated record values should not be patched");

const telemetryResult = runSurgeScript({
  request: { url: "https://www.notion.so/api/v3/etClient", method: "POST" },
  response: {
    status: 200,
    headers: {},
    body: JSON.stringify({ collection_peek_mode: "side_peek" }),
  },
});
assert.deepEqual(telemetryResult, {}, "ordinary API responses should not be text patched");

const transaction = {
  requestId: "x",
  transactions: [
    {
      operations: [
        {
          pointer: { table: "collection_view", id: "a", spaceId: "s" },
          path: ["format", "collection_peek_mode"],
          command: "set",
          args: "side_peek",
        },
      ],
    },
  ],
};

const requestResult = runSurgeScript({
  request: {
    url: "https://www.notion.so/api/v3/saveTransactions",
    method: "POST",
    body: JSON.stringify(transaction),
  },
});
assert(requestResult.body, "request body should be changed");
const patchedRequest = JSON.parse(requestResult.body);
assert.equal(
  patchedRequest.transactions[0].operations[0].args,
  "center_peek",
);

const urlResult = runSurgeScript({
  request: {
    url: "https://www.notion.so/example?p=abc&pm=s",
    method: "GET",
  },
});
assert.equal(urlResult.url, "https://www.notion.so/example?p=abc&pm=c");

const fullPageUrlResult = runSurgeScript({
  request: {
    url: "https://www.notion.so/example?p=abc&pm=f",
    method: "GET",
  },
});
assert.equal(fullPageUrlResult.url, "https://www.notion.so/example?p=abc&pm=c");

const assetBody =
  'x;let i={table:"side_peek",board:"side_peek",calendar:"center_peek",list:"side_peek",gallery:"center_peek",timeline:"side_peek",page:"side_peek",chat:"side_peek"};const q="?pm=s";open({peekMode:u,openInNew:l});const params={pm:"s"};y';
const assetResult = runSurgeScript({
  request: { url: "https://www.notion.so/_assets/example.js", method: "GET" },
  response: { status: 200, headers: {}, body: assetBody },
});
assert(assetResult.body, "asset body should be changed");
assert(assetResult.body.includes('table:"center_peek"'));
assert(assetResult.body.includes('chat:"center_peek"'));
assert(assetResult.body.includes('"?pm=c"'));
assert(assetResult.body.includes('peekMode:"center_peek",openInNew'));
assert(assetResult.body.includes('pm:"c"'));

const requestPatternMatch = moduleSource.match(/notion-center-peek-request = .*pattern=([^,]+)/);
assert(requestPatternMatch, "request script pattern should exist in module");
const requestPattern = new RegExp(requestPatternMatch[1]);
assert(requestPattern.test("https://www.notion.so/api/v3/saveTransactions"));
assert(requestPattern.test("https://www.notion.so/example?p=abc&pm=s"));
assert(!requestPattern.test("https://www.notion.so/api/v3/getActiveThreadsForBlocks"));

const responsePatternMatch = moduleSource.match(/notion-center-peek-response = .*pattern=([^,]+)/);
assert(responsePatternMatch, "response script pattern should exist in module");
const responsePattern = new RegExp(responsePatternMatch[1]);
assert(responsePattern.test("https://www.notion.so/api/v3/loadPageChunk"));
assert(responsePattern.test("https://www.notion.so/api/v3/loadCachedPageChunkV2"));
assert(responsePattern.test("https://www.notion.so/api/v3/queryCollection"));
assert(responsePattern.test("https://www.notion.so/_assets/example.js"));
assert(!responsePattern.test("https://www.notion.so/api/v3/getInferenceTranscriptsUnreadCount"));
assert(!responsePattern.test("https://www.notion.so/api/v3/etClient"));

console.log("Notion center-peek rewrite tests passed.");
