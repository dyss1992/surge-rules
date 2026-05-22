# Surge Rules

Public Surge modules and scripts.

## Notion Peek Mode Override

`modules/notion-center-peek.sgmodule` is a Surge module that overrides how Notion opens database and relation pages. The default settings still force center peek, but Surge users can edit the module parameters directly.

It works by rewriting Notion HTTPS traffic after Surge MITM decryption:

- page and database response data containing `collection_view` records is normalized to the configured database view mode
- request data that tries to save another `collection_peek_mode` for a collection view is normalized back to the configured database view mode, including Notion's fanout save endpoint used by newly created views
- Notion peek URLs using `pm` are changed to the configured URL mode
- Notion frontend defaults for database, relation, no-view fallback, and matched open calls are patched toward the configured modes when they are present in the asset whitelist
- explicit frontend actions such as `Open in side peek` are redirected toward the configured client open mode
- Notion's Service Worker fetches are narrowed where Surge can see them, so the small set of peek-related frontend files is less likely to be reused from Notion's local frontend cache

The request-side rules are intentionally split between Notion's Service Worker, Notion's save endpoint, peek URLs, and the confirmed runtime page-open chunk `67426-*`. The response-side rules are limited to the Service Worker when it is visible to Surge, page/database loading endpoints, and a semantic whitelist of frontend chunks whose names relate to Relation pages, peek rendering, database views, and page properties. Legacy chunk IDs (`61315-*`, `71688-*`, and `67535-*`) are still included for older cached Notion builds. Confirmed numeric action chunks are limited to the small row-open chunk `27899-*` and the current runtime page-open chunk `67426-*`; the module still skips unrelated large numeric chunks instead of processing the whole Notion frontend.

### Request Scope

Processed:

- `api/v3/loadPageChunk`, `loadCachedPageChunkV2`, `queryCollection`, `syncRecordValues`, `syncRecordValuesSpaceInitial`, `getCollectionData`, `getRecordValues`, and `getPublicPageData`
- `api/v3/saveTransactions` and `api/v3/saveTransactionsFanout`
- `sw.js`, only to reduce cases where peek-related frontend files are served out of Notion's Service Worker cache
- Notion URLs that already include a `pm` peek parameter
- the request for the confirmed runtime page-open chunk `67426-*`, where the module asks Notion for an uncompressed response so Surge can safely rewrite it
- whitelisted Notion frontend chunks under `_assets/` and `_assets/experimental/`:
  - legacy cached chunks: `61315-*`, `71688-*`, and `67535-*`
  - confirmed numeric action chunks that contain peek/open signals, currently `27899-*`, capped at 768 KiB before script processing
  - the confirmed runtime page-open chunk `67426-*`, capped at 4 MiB before script processing
  - semantic Relation chunks such as `RelationPropertyWithEdges-*`, `RelationPropertyOverlayWithEdges-*`, `RelationPropertyMenu-*`, `RelationMenuRow-*`, and `createRelationViewsModule-*`
  - selected peek/database/page-property chunks such as `CollectionViewBlock-*`, `BlockPropertyRouter-*`, `peekRenderer-*`, `PagePropertiesRowNameMenu-*`, `RecordStore-*`, `formPropertyRenderer-*`, `RollupPropertyMenu-*`, and `PropertyModulePersonProperty-*`

Skipped:

- unrelated Notion API calls, including telemetry and AI/background endpoints
- unrelated Service Worker behavior; the module only changes cache handling for the same peek-related frontend files listed above, and leaves Notion's other caching behavior alone
- generic `_assets/` files such as app bundles, framework bundles, CSS, images, fonts, source maps, unconfirmed large numeric JS chunks, and unrelated JS chunks
- responses whose content type, size, URL, or text content clearly does not need peek-mode rewriting
- large API responses above 3 MiB, whitelisted frontend asset responses above 4 MiB, the small `27899-*` action chunk above 768 KiB, and Service Worker responses above 256 KiB

### Install

Import this module in Surge:

```text
https://raw.githubusercontent.com/dyss1992/surge-rules/main/modules/notion-center-peek.sgmodule
```

Then reload Surge, update the module resource, and refresh or restart Notion.

### First-Run Checklist

For a new user, use this order:

1. Quit Notion completely.
2. Import and enable the Surge module.
3. Make sure Surge has MITM, Rewrite, and Scripting enabled.
4. Make sure the device trusts the Surge CA certificate.
5. Reload Surge and update the module script resource.
6. Open Notion and load a Notion page from the network.
7. Open a database row or Relation page and check the URL:
   - `pm=c` means center peek
   - `pm=s` means side peek
   - `pm=f` means full page

If it still opens with the old mode, the most common cause is cached Notion frontend files. This module marks rewritten Notion frontend chunks as `no-store` and also reduces Service Worker caching when Surge can see the relevant request. Parameter changes still cannot update code that Notion has already loaded into the running app. In normal use, reload Surge / update the module resource, then restart or reload Notion. If the old mode is still sticky, do a one-time frontend cache clear: quit Notion, clear only Notion's frontend cache / Service Worker cache, then reopen Notion while Surge is already enabled. Do not clear cookies, local storage, IndexedDB, or account data unless you intentionally want to sign in again.

On macOS, the relevant cache folders are usually under:

```text
~/Library/Application Support/Notion/Cache
~/Library/Application Support/Notion/Code Cache
~/Library/Application Support/Notion/notionAssetCache-v2
~/Library/Application Support/Notion/Partitions/notion/Cache
~/Library/Application Support/Notion/Partitions/notion/Code Cache
~/Library/Application Support/Notion/Partitions/notion/Service Worker
```

After clearing those folders, restart Notion and test again. The first reload may be slower because Notion needs to download its frontend files again.

### Editable Parameters

Surge shows these values in the module's edit-parameter panel:

| Parameter | Default | Meaning |
|---|---:|---|
| `target_mode` | `center_peek` | Default mode used by the other parameters. Valid values: `center_peek`, `side_peek`, `full_page`. |
| `collection_view_mode` | `target` | Database view setting. Use `target` to follow `target_mode`. |
| `relation_property_mode` | `target` | Pages opened from Relation properties. Use `target` to follow `target_mode`. |
| `fallback_peek_mode` | `target` | Notion fallback when no database view mode is available. Use `target` to follow `target_mode`. |
| `client_open_mode` | `target` | Other matched Notion frontend open calls. Use `target` to follow `target_mode`. |
| `url_pm` | `auto` | URL `pm` value. Use `auto` to follow `target_mode`, or set `c`, `s`, `f`. |

Common examples:

- Keep the default center peek behavior: leave all parameters unchanged.
- Force full page everywhere: set `target_mode` to `full_page` and leave the others as `target` / `auto`.
- Only keep Relation pages in side peek: set `relation_property_mode` to `side_peek`.

### Requirements

- Surge MITM, Rewrite, and Scripting must be enabled.
- The device using Notion must trust the Surge CA certificate.
- The module appends `-api.notion.com`, `*.notion.so`, and `*.notion.com` to the MITM host list in that order, so official Notion API clients keep the original TLS certificate chain while the Notion web app remains decryptable for the peek-mode rewrite.

### Limits

This is an unofficial workaround. It depends on Notion continuing to send compatible JSON records or compatible frontend asset text. The asset whitelist is based on chunk names instead of exact hashes where possible, and confirmed numeric action chunks are explicitly named so database row open actions can be covered without processing the whole Notion frontend bundle. Already loaded Notion frontend code cannot be changed retroactively, so parameter changes may still need a Notion restart or page reload before they are visible.

### Validation

Run:

```sh
node tests/notion-center-peek.test.js
```

To validate the Surge module syntax, include it in a Surge profile and run `surge-cli --check`.
