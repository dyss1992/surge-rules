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

function runSurgeScript({ request, response, argument }) {
  let doneValue;
  const context = {
    URL,
    Set,
    JSON,
    Object,
    Array,
    console,
    $request: request,
    $argument: argument,
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

const fanoutTransaction = {
  transactions: [
    {
      operations: [
        {
          pointer: { table: "collection_view", id: "new-view", spaceId: "s" },
          path: [],
          command: "set",
          args: {
            id: "new-view",
            type: "table",
            format: { table_wrap: false },
          },
        },
      ],
    },
  ],
};

const fanoutRequestResult = runSurgeScript({
  request: {
    url: "https://www.notion.so/api/v3/saveTransactionsFanout",
    method: "POST",
    body: JSON.stringify(fanoutTransaction),
  },
});
assert(fanoutRequestResult.body, "fanout request body should be changed");
assert.equal(
  JSON.parse(fanoutRequestResult.body).transactions[0].operations[0].args.format
    .collection_peek_mode,
  "center_peek",
);

const urlResult = runSurgeScript({
  request: {
    url: "https://www.notion.so/example?p=abc&pm=s",
    method: "GET",
  },
});
assert.equal(urlResult.url, "https://www.notion.so/example?p=abc&pm=c");

const centerUrlResult = runSurgeScript({
  request: {
    url: "https://www.notion.so/example?p=abc&pm=center_peek",
    method: "GET",
  },
});
assert.equal(centerUrlResult.url, "https://www.notion.so/example?p=abc&pm=c");

const fullPageUrlResult = runSurgeScript({
  request: {
    url: "https://www.notion.so/example?p=abc&pm=f",
    method: "GET",
  },
});
assert.equal(fullPageUrlResult.url, "https://www.notion.so/example?p=abc&pm=c");

const assetBody =
  'x;let i={table:"side_peek",board:"side_peek",calendar:"center_peek",list:"side_peek",gallery:"center_peek",timeline:"side_peek",page:"side_peek",chat:"side_peek"};const q="?pm=s";function Row({peekMode:u,openInNew:l}){return u}let fallback=(null==e?void 0:e.normalizedFormatStore.state.collection_peek_mode)??(o?r(476670).C9[o]:"side_peek");open({environment:t,store:i,peekMode:u,openInNew:l});openParent({from:"relation_property",peekMode:"side_peek"});const params={pm:"s"};y';
const assetResult = runSurgeScript({
  request: { url: "https://www.notion.so/_assets/61315-155b15305540931a.js", method: "GET" },
  response: { status: 200, headers: { "content-type": "application/javascript" }, body: assetBody },
});
assert(assetResult.body, "asset body should be changed");
assert(assetResult.body.includes('table:"center_peek"'));
assert(assetResult.body.includes('chat:"center_peek"'));
assert(assetResult.body.includes('??(o?r(476670).C9[o]:"center_peek")'));
assert(assetResult.body.includes('"?pm=c"'));
assert(assetResult.body.includes('function Row({peekMode:u,openInNew:l})'));
assert(assetResult.body.includes('open({environment:t,store:i,peekMode:"center_peek",openInNew'));
assert(assetResult.body.includes('openParent({from:"relation_property",peekMode:"center_peek"})'));
assert(assetResult.body.includes('pm:"c"'));

const runtimeAssetResult = runSurgeScript({
  request: { url: "https://www.notion.so/_assets/67426-b75a8a2b8268549d.js", method: "GET" },
  response: { status: 200, headers: { "content-type": "text/javascript" }, body: assetBody },
});
assert(runtimeAssetResult.body, "runtime asset body should be changed");
assert(runtimeAssetResult.body.includes('table:"center_peek"'));
assert(runtimeAssetResult.body.includes('??(o?r(476670).C9[o]:"center_peek")'));
assert(runtimeAssetResult.body.includes('pm:"c"'));

const functionParameterAsset =
  'function n({environment:e,store:t,pageVisitSource:r,visitType:l,openInNew:s,peekMode:d,redirect:c}){return d}open({environment:e,store:t,peekMode:d,openInNew:s});';
const functionParameterResult = runSurgeScript({
  request: { url: "https://www.notion.so/_assets/67426-b75a8a2b8268549d.js", method: "GET" },
  response: {
    status: 200,
    headers: { "content-type": "text/javascript" },
    body: functionParameterAsset,
  },
});
assert(functionParameterResult.body, "function parameter fixture should still patch call sites");
assert(
  functionParameterResult.body.includes("peekMode:d,redirect:c"),
  "function parameter destructuring must not be rewritten",
);
assert(functionParameterResult.body.includes('open({environment:e,store:t,peekMode:"center_peek"'));
new Function(functionParameterResult.body);

const skippedAssetResult = runSurgeScript({
  request: { url: "https://www.notion.so/_assets/app-f37b78ccba80bafb.js", method: "GET" },
  response: { status: 200, headers: { "content-type": "application/javascript" }, body: assetBody },
});
assert.deepEqual(skippedAssetResult, {}, "non-whitelisted assets should be skipped");

const cssAssetResult = runSurgeScript({
  request: { url: "https://www.notion.so/_assets/61315-155b15305540931a.js", method: "GET" },
  response: { status: 200, headers: { "content-type": "text/css" }, body: assetBody },
});
assert.deepEqual(cssAssetResult, {}, "non-script responses should be skipped");

const customArgument =
  "target_mode=side_peek&collection_view_mode=full_page&relation_property_mode=side_peek&fallback_peek_mode=center_peek&client_open_mode=full_page&url_pm=f";
const customResponseResult = runSurgeScript({
  request: { url: "https://www.notion.so/api/v3/loadPageChunk", method: "POST" },
  response: { status: 200, headers: {}, body: JSON.stringify(loadPageResponse) },
  argument: customArgument,
});
assert(customResponseResult.body, "custom response body should be changed");
const customPatchedResponse = JSON.parse(customResponseResult.body);
assert.equal(
  customPatchedResponse.recordMap.collection_view.a.value.format.collection_peek_mode,
  "full_page",
);
assert.equal(
  customPatchedResponse.recordMap.collection_view.b.value.format.collection_peek_mode,
  "full_page",
);

const customRequestResult = runSurgeScript({
  request: {
    url: "https://www.notion.so/api/v3/saveTransactions",
    method: "POST",
    body: JSON.stringify(transaction),
  },
  argument: customArgument,
});
assert(customRequestResult.body, "custom request body should be changed");
assert.equal(
  JSON.parse(customRequestResult.body).transactions[0].operations[0].args,
  "full_page",
);

const customUrlResult = runSurgeScript({
  request: {
    url: "https://www.notion.so/example?p=abc&pm=c",
    method: "GET",
  },
  argument: customArgument,
});
assert.equal(customUrlResult.url, "https://www.notion.so/example?p=abc&pm=f");

const customAssetResult = runSurgeScript({
  request: { url: "https://www.notion.so/_assets/61315-155b15305540931a.js", method: "GET" },
  response: { status: 200, headers: { "content-type": "application/javascript" }, body: assetBody },
  argument: customArgument,
});
assert(customAssetResult.body, "custom asset body should be changed");
assert(customAssetResult.body.includes('table:"full_page"'));
assert(customAssetResult.body.includes('chat:"full_page"'));
assert(customAssetResult.body.includes('??(o?r(476670).C9[o]:"center_peek")'));
assert(customAssetResult.body.includes('"?pm=f"'));
assert(customAssetResult.body.includes('function Row({peekMode:u,openInNew:l})'));
assert(customAssetResult.body.includes('open({environment:t,store:i,peekMode:"full_page",openInNew'));
assert(customAssetResult.body.includes('openParent({from:"relation_property",peekMode:"side_peek"})'));
assert(customAssetResult.body.includes('pm:"f"'));

const relationAssetBody =
  'let z=j&&e?j.getFormatStore().getKeyValue("collection_peek_mode")??n(476670).C9[e]:n(475097).default.state.mode;(0,n(553180).V)({environment:t,store:i,peekMode:u,openInNew:l,resultsStore:r,peekCollectionData:d,pageVisitSource:n(254656).y8.PeekOpen});let d=(0,n(234310).A)({pageId:c.id,pageModel:e,baseUrl:t,peekViewBlockId:u.id,pageVisitSource:n(254656).y8.MentionInPage});let q=(0,n(234310).A)({pageId:c.id,pageModel:e,baseUrl:t,peekViewBlockId:u.id,peekMode:(0,n(328823).f)("full_page"===l?void 0:l??n(475097).default.state.mode),pageVisitSource:n(254656).y8.MentionInPage})';
const relationAssetResult = runSurgeScript({
  request: {
    url: "https://www.notion.so/_assets/RelationMenuRow-deb278cf92066cae.js",
    method: "GET",
  },
  response: {
    status: 200,
    headers: { "content-type": "application/javascript" },
    body: relationAssetBody,
  },
  argument: customArgument,
});
assert(relationAssetResult.body, "relation semantic asset should be changed");
assert(relationAssetResult.body.includes('peekMode:"side_peek",openInNew:l'));
assert(
  relationAssetResult.body.includes(
    'peekViewBlockId:u.id,peekMode:"side_peek",pageVisitSource',
  ),
);
assert(
  relationAssetResult.body.includes(
    'peekViewBlockId:u.id,peekMode:"side_peek",pageVisitSource:n(254656).y8.MentionInPage',
  ),
);

const collectionViewUrlBuilderAsset =
  'let a=o(457498).wy({environment:t,store:i,mainEditorCurrentBlockStore:n,peekCollectionData:o(457498).q0(r),fullyQualified:!1});let b=o(457498).wy({environment:t,store:i,mainEditorCurrentBlockStore:n,peekCollectionData:o(457498).q0(r),fullyQualified:!1,overridePeekMode:h?"side_peek":void 0});let c=(0,o(553180).V)({environment:t,store:i,peekMode:u,resultsStore:r,peekCollectionData:d});';
const collectionViewUrlBuilderResult = runSurgeScript({
  request: {
    url: "https://www.notion.so/_assets/CollectionViewBlock-88dbba0bb96d8b72.js",
    method: "GET",
  },
  response: {
    status: 200,
    headers: { "content-type": "application/javascript" },
    body: collectionViewUrlBuilderAsset,
  },
});
assert(collectionViewUrlBuilderResult.body, "collection view URL builder should be changed");
assert(
  collectionViewUrlBuilderResult.body.includes(
    'peekCollectionData:o(457498).q0(r),overridePeekMode:"center_peek",fullyQualified:!1',
  ),
);
assert(
  collectionViewUrlBuilderResult.body.includes(
    'fullyQualified:!1,overridePeekMode:"center_peek"',
  ),
);
assert(
  !collectionViewUrlBuilderResult.body.includes(
    'peekMode:u,overridePeekMode:"center_peek"',
  ),
  "open calls with explicit peekMode should not get overridePeekMode inserted",
);

assert(moduleSource.includes("#!arguments=target_mode:center_peek"));
assert(moduleSource.includes("fallback_peek_mode:target"));
assert(moduleSource.includes("argument=\"target_mode={{{target_mode}}}"));
assert(moduleSource.includes("fallback_peek_mode={{{fallback_peek_mode}}}"));

const saveRequestPatternMatch = moduleSource.match(/notion-peek-save-request = .*pattern=([^,]+)/);
assert(saveRequestPatternMatch, "save request script pattern should exist in module");
const saveRequestPattern = new RegExp(saveRequestPatternMatch[1]);
assert(saveRequestPattern.test("https://www.notion.so/api/v3/saveTransactions"));
assert(saveRequestPattern.test("https://www.notion.so/api/v3/saveTransactionsFanout"));
assert(!saveRequestPattern.test("https://www.notion.so/example?p=abc&pm=s"));
assert(!saveRequestPattern.test("https://www.notion.so/api/v3/getActiveThreadsForBlocks"));

const urlRequestPatternMatch = moduleSource.match(/notion-peek-url-request = .*pattern=([^,]+)/);
assert(urlRequestPatternMatch, "URL request script pattern should exist in module");
const urlRequestPattern = new RegExp(urlRequestPatternMatch[1]);
assert(urlRequestPattern.test("https://www.notion.so/example?p=abc&pm=s"));
assert(!urlRequestPattern.test("https://www.notion.so/api/v3/saveTransactions"));

const apiResponsePatternMatch = moduleSource.match(/notion-peek-api-response = .*pattern=([^,]+)/);
assert(apiResponsePatternMatch, "API response script pattern should exist in module");
const apiResponsePattern = new RegExp(apiResponsePatternMatch[1]);
assert(apiResponsePattern.test("https://www.notion.so/api/v3/loadPageChunk"));
assert(apiResponsePattern.test("https://www.notion.so/api/v3/loadCachedPageChunkV2"));
assert(apiResponsePattern.test("https://www.notion.so/api/v3/queryCollection"));
assert(!apiResponsePattern.test("https://www.notion.so/_assets/61315-155b15305540931a.js"));
assert(!apiResponsePattern.test("https://www.notion.so/api/v3/getInferenceTranscriptsUnreadCount"));
assert(!apiResponsePattern.test("https://www.notion.so/api/v3/etClient"));

const assetResponsePatternMatch = moduleSource.match(/notion-peek-asset-response = .*pattern=([^,]+)/);
assert(assetResponsePatternMatch, "asset response script pattern should exist in module");
const assetResponsePattern = new RegExp(assetResponsePatternMatch[1]);
assert(assetResponsePattern.test("https://www.notion.so/_assets/61315-155b15305540931a.js"));
assert(assetResponsePattern.test("https://www.notion.so/_assets/71688-e34e6503c2f2c1ee.js"));
assert(assetResponsePattern.test("https://www.notion.so/_assets/67535-696bada3b43698b0.js"));
assert(assetResponsePattern.test("https://www.notion.so/_assets/67426-b75a8a2b8268549d.js"));
assert(assetResponsePattern.test("https://www.notion.so/_assets/RelationPropertyWithEdges-e8ca79f7e53b5a56.js"));
assert(assetResponsePattern.test("https://www.notion.so/_assets/RelationMenuRow-deb278cf92066cae.js"));
assert(assetResponsePattern.test("https://www.notion.so/_assets/createRelationViewsModule-7717e10f8cbb230f.js"));
assert(assetResponsePattern.test("https://www.notion.so/_assets/BlockPropertyRouter-2cff2062b0864e1a.js"));
assert(assetResponsePattern.test("https://www.notion.so/_assets/peekRenderer-cf552f7a2cb863af.js"));
assert(assetResponsePattern.test("https://www.notion.so/_assets/CollectionViewBlock-2a85c7e230ae3bdd.js"));
assert(assetResponsePattern.test("https://www.notion.so/_assets/RecordStore-c0e43bffee395906.js"));
assert(assetResponsePattern.test("https://www.notion.so/_assets/PagePropertiesRowNameMenu-707f058897e8b67d.js"));
assert(!assetResponsePattern.test("https://www.notion.so/_assets/example.js"));
assert(!assetResponsePattern.test("https://www.notion.so/_assets/app-f37b78ccba80bafb.js"));
assert(!assetResponsePattern.test("https://www.notion.so/_assets/ClientFramework-a9bca7b48ce7d38f.js"));
assert(!assetResponsePattern.test("https://www.notion.so/_assets/notion.css"));
const mitmHostnameMatch = moduleSource.match(/^hostname\s*=\s*(.*)$/m);
assert(mitmHostnameMatch, "MITM hostname line should exist");
assert(
  mitmHostnameMatch[1].indexOf("-api.notion.com") <
    mitmHostnameMatch[1].indexOf("*.notion.com"),
  "Notion API MITM exclusion should come before the Notion wildcard",
);

console.log("Notion peek-mode rewrite tests passed.");
