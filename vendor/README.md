# vendor/ — third-party libraries, served from our own Pages

Five apps already load `gx-theme.css`, `gx-client.js`, `gx-session.js` and friends from
`greencrosscanna.github.io` by URL. These libraries now come from the same place.

## Why, precisely

Not because a CDN is unreliable, and not because the versions might drift — every reference was
already pinned to an exact version, so nothing was going to upgrade underneath us.

It is about **how many independent things have to be up at once.** Inventory's barcode scanner needed
unpkg **and** jsdelivr **and** GitHub Pages **and** Apps Script, all simultaneously, and unpkg carried
three of those loads with no fallback. Removing a whole failure domain from an AND-chain raises
availability no matter how reliable that domain is on its own.

The obvious objection is that this just moves the dependency to GitHub Pages. It does — onto a
dependency **the apps already cannot run without**. Every app fetches its shared layer from Pages at
boot, so a Pages outage was already fatal. The marginal loss is zero and the marginal gain is one
fewer host in the chain.

Second, smaller reason: a CDN is a place someone else can serve altered bytes from. An app that scans
product barcodes and writes to live inventory should not take that on when the fix costs 1.9 MB.

## Rules

- **Never edit a file in here.** They are upstream bytes, verbatim. `verify.sh` proves it and will
  fail if anyone "just tweaks" one.
- **The version is in the path** (`vendor/xlsx@0.18.5/…`), so a spoke's `<script src>` states its own
  pin. Never add an unversioned path or a `latest` alias.
- **Re-vendoring is its own change.** Do not bump a version in the same commit that moves an app onto
  the vendored copy — a regression then has two possible causes and you cannot tell which.
- `SOURCES.tsv` records where each file came from and its licence; `SHA256SUMS` records the bytes.

## Verify

```sh
sh vendor/verify.sh          # checksums match what is committed
sh vendor/verify.sh --remote # AND re-fetch upstream and diff, proving we altered nothing
```

## Licences

All permissive and redistributable with attribution: Apache-2.0 (SheetJS `xlsx`, `jsQR`,
`html5-qrcode`) and MIT (`@zxing/library`, `Chart.js`). Attribution is the upstream header comment
inside each file, which is why these are the un-stripped distributions.

## Known, checked, not applicable

`xlsx@0.18.5` predates the fixes for CVE-2023-30533 (prototype pollution) and CVE-2024-22363 (ReDoS).
**Both are in the PARSER.** Inventory only ever writes: `book_new`, `aoa_to_sheet`,
`book_append_sheet`, `XLSX.write` — there is no `XLSX.read` or `readFile` anywhere in the suite, so
neither is reachable. Worth bumping on its own merits; not worth calling an exposure. Re-check this
note if any app ever starts importing spreadsheets.
