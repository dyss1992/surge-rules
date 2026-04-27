# Surge Rules

Public Surge modules and scripts.

## Notion Peek Mode Override

`modules/notion-center-peek.sgmodule` is a Surge module that overrides how Notion opens database and relation pages. The default settings still force center peek, but Surge users can edit the module parameters directly.

It works by rewriting Notion HTTPS traffic after Surge MITM decryption:

- page and database response data containing `collection_view` records is normalized to the configured database view mode
- request data that tries to save another `collection_peek_mode` for a collection view is normalized back to the configured database view mode
- Notion peek URLs using `pm` are changed to the configured URL mode
- Notion frontend asset defaults for database, relation, no-view fallback, and matched open calls are patched toward the configured modes when they are present in matched assets

The request-side rule is intentionally limited to Notion's save endpoint and peek URLs. The response-side rule is limited to page/database loading endpoints and frontend assets so unrelated Notion API calls are not marked as modified in Surge.

### Install

Import this module in Surge:

```text
https://raw.githubusercontent.com/dyss1992/surge-rules/main/modules/notion-center-peek.sgmodule
```

Then reload Surge and refresh or restart Notion.

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
- The module appends `*.notion.so` and `*.notion.com` to the MITM host list.

### Limits

This is an unofficial workaround. It depends on Notion continuing to send compatible JSON records or compatible frontend asset text. Cached local Notion data may still need a refresh or restart before the change is visible.

### Validation

Run:

```sh
node tests/notion-center-peek.test.js
```

To validate the Surge module syntax, include it in a Surge profile and run `surge-cli --check`.
