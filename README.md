# Surge Rules

Public Surge modules and scripts.

## Notion Center Peek

`modules/notion-center-peek.sgmodule` is a Surge module that tries to make Notion database pages open with center peek.

It works by rewriting Notion HTTPS traffic after Surge MITM decryption:

- page and database response data containing `collection_view` records is normalized to `collection_peek_mode: "center_peek"`
- request data that tries to save `side_peek` or `full_page` for a collection view is normalized back to `center_peek`
- Notion peek URLs using `pm=s` or `pm=f` are changed to `pm=c`
- Notion frontend asset defaults for side peek are patched toward center peek when they are present in matched assets

The request-side rule is intentionally limited to Notion's save endpoint and peek URLs. The response-side rule is limited to page/database loading endpoints and frontend assets so unrelated Notion API calls are not marked as modified in Surge.

### Install

Import this module in Surge:

```text
https://raw.githubusercontent.com/dyss1992/surge-rules/main/modules/notion-center-peek.sgmodule
```

Then reload Surge and refresh or restart Notion.

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
