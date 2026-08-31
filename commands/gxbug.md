---
description: /gxbug — file a bug against any GX app from any chat, by name
argument-hint: [what's broken, e.g. the brain won't load settings]
---

File a bug into GX Core's shared `bug_reports` board — the one log every app feeds and the Command
Center triages. Works from any app chat.

Report: "$ARGUMENTS"

<!-- @include _gxcore.md -->

## 1. Work out which app it is against

**Do not guess, and do not assume it is this chat's app.** Sky calls the same app different things on
different days — the Command Center is also "the brain", "core", "the cockpit", "Master Control". That
is exactly why the registry exists.

- If the report opens with an app name, resolve it. Try the LONGEST leading phrase first and work
  down, because "the brain" is two words and "brain" is one:

  ```sh
  curl -sL -G "<GXCORE>" --data-urlencode action=resolve_app --data-urlencode "name=the brain"
  # -> {"ok":true,"slug":"core-admin","official_name":"Command Center"}
  ```

- If nothing resolves, default to **this chat's own app** — the key in its `CLAUDE.md`, or `cat .gx_app`.
- If the text names an app you cannot resolve AND this chat's key would contradict it, **ask** rather
  than filing against the wrong board. A bug on the wrong app's board is worse than no bug: it waits
  in a queue whose owner cannot reproduce it.

Strip the resolved app name off the front of the title — "the brain won't load settings" filed against
core-admin should read "Won't load settings", not repeat the app in its own title.

## 2. Fill in what you already know

You are in the repo. Do not make the reporter supply what you can read:

- `app_version` — the app's version constant (`APP_VERSION`, `GC.VERSION`, or the `?v=NN` cache-buster).
- `tab` — the sub-app if the report names one (`pricecards`, `spiff`), so bug routing sends it to the
  right chat rather than the parent's.
- `severity` — `low` · `normal` · `high` · `critical`. Default `normal`. Read it from the language:
  data loss, a security hole, or "everyone is blocked" is `critical` or `high`. Do not inflate;
  a board where everything is high is a board with no priorities.
- `detail` — the report, plus anything you genuinely know: the error text, the file and line if you
  have already looked, what you ruled out. **Do not invent reproduction steps you have not run.**

## 3. Confirm before filing

**Always show the reader what you are about to file and wait for a yes.** This lands on a shared board
that other people act on, and a bug filed against the wrong app or with a misleading title costs
someone else their time. Show: target app (and why it resolved that way), title, severity, detail.

## 4. File it

```sh
curl -sL -G "<GXCORE>" --data-urlencode action=ingest_bug \
  --data-urlencode "secret=$(cat .gx_deploy_secret)" \
  --data-urlencode app=<slug> --data-urlencode reporter=sky \
  --data-urlencode 'title=…' --data-urlencode 'detail=…' \
  --data-urlencode severity=normal --data-urlencode app_version=<ver> --data-urlencode tab=<sub-app>
```

**If it returns a lock timeout, retry verbatim.** `ingest_bug` de-dupes, and the response says
`retry_safe`. Do not go and check the board first — that costs ten minutes and changes nothing.

## 5. Report back

Say what you filed — **by its title, not its id** — the app it landed on, and plainly that it is now on
the Command Center board and in that app's `/gxbrain` inbox. `bug_mtg9vyxs_ewd9` on its own is not a
report; *"filed 'Won't load settings' against the Command Center (bug_mtg9vyxs_ewd9)"* is.

<!-- @include _naming.md -->
 If the target was NOT this chat's app, say so explicitly — the reader
should never have to wonder where it went.

**If you can fix it right now and it is this chat's app, say so and offer.** A bug filed and fixed in
the same minute is better than a bug filed; the log still gets its entry, and `bug_update` closes it
with a resolution.
