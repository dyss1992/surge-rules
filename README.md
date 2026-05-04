# Surge Rules

Public Surge modules and scripts.

## Notion Peek Mode Override

`modules/notion-center-peek.sgmodule` is a Surge module that overrides how Notion opens database and relation pages. The default settings still force center peek, but Surge users can edit the module parameters directly.

It works by rewriting Notion HTTPS traffic after Surge MITM decryption:

- page and database response data containing `collection_view` records is normalized to the configured database view mode
- request data that tries to save another `collection_peek_mode` for a collection view is normalized back to the configured database view mode
- Notion peek URLs using `pm` are changed to the configured URL mode
- Notion frontend defaults for database, relation, no-view fallback, and matched open calls are patched toward the configured modes when they are present in the small asset whitelist

The request-side rules are intentionally split between Notion's save endpoint and peek URLs. The response-side rules are limited to page/database loading endpoints plus a small whitelist of known frontend chunks (`61315-*`, `71688-*`, and `67535-*`). This avoids sending every Notion `_assets/` JS/CSS/image/font response through the script and keeps Surge Recent Requests much smaller.

### Request Scope

Processed:

- `api/v3/loadPageChunk`, `loadCachedPageChunkV2`, `queryCollection`, `syncRecordValues`, `syncRecordValuesSpaceInitial`, `getCollectionData`, `getRecordValues`, and `getPublicPageData`
- `api/v3/saveTransactions`
- Notion URLs that already include a `pm` peek parameter
- whitelisted Notion frontend chunks: `61315-*`, `71688-*`, and `67535-*`

Skipped:

- unrelated Notion API calls, including telemetry and AI/background endpoints
- generic `_assets/` files such as app bundles, CSS, images, fonts, source maps, and unrelated JS chunks
- responses whose content type, size, URL, or text content clearly does not need peek-mode rewriting
- large API responses above 3 MiB and whitelisted frontend asset responses above 4 MiB

### Install

Import this module in Surge:

```text
https://raw.githubusercontent.com/dyss1992/surge-rules/main/modules/notion-center-peek.sgmodule
```

Then reload Surge and refresh or restart Notion.

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

If it still opens with the old mode, the most common cause is cached Notion frontend files. Quit Notion, clear only Notion's frontend cache / Service Worker cache, then reopen Notion while Surge is already enabled. Do not clear cookies, local storage, IndexedDB, or account data unless you intentionally want to sign in again.

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
- The module appends `*.notion.so` and `*.notion.com` to the MITM host list, but explicitly excludes `api.notion.com` so official Notion API clients keep the original TLS certificate chain.

### Limits

This is an unofficial workaround. It depends on Notion continuing to send compatible JSON records or compatible frontend asset text. Cached local Notion data may still need a refresh or restart before the change is visible. If Notion moves the relevant frontend code into different chunk IDs, the asset whitelist may need to be updated while the API and URL rules can remain narrow.

### Validation

Run:

```sh
node tests/notion-center-peek.test.js
```

To validate the Surge module syntax, include it in a Surge profile and run `surge-cli --check`.
