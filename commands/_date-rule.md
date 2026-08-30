**A CALENDAR DAY IS ALWAYS LOS ANGELES. AN INSTANT IS ALWAYS UTC. Never mix them up.**

Every Apps Script project in this suite is set to `America/Los_Angeles`. That setting does **not**
reach `toISOString()`, which is always UTC. So this is wrong, everywhere, in every app:

```js
new Date().toISOString().slice(0, 10)      // UTC. From 17:00 PT to midnight, this is TOMORROW.
```

Seven hours of every day, eight in winter, that line writes a date one day ahead. Nothing throws,
nothing logs, and the value looks completely normal. It ran undetected in GX Core's own `gxToday_()`
— the helper whose comment read *"TEXT date for sheet cells"* — for the entire life of the function,
across `users`, `app_access`, `products` and `employees`. Found 2026-08-29, only because Sky asked
whether the apps were on LA time. The project settings said yes; the code said no.

**Use these:**

```js
function today_()    { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd'); }
function nowStamp_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm:ss'); }
function nowIso_()   { return new Date().toISOString(); }   // an INSTANT — UTC is correct, leave it
```

Write the timezone as a **literal**, not a constant. An undeclared identifier inside a scheduled
trigger throws a `ReferenceError`, the trigger dies, and it looks exactly like nothing is wrong.

**Three things that are NOT this bug — do not "fix" them:**

- `new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)` — built in UTC, read in UTC. Round-trips
  exactly, and is the right way to do date-only arithmetic.
- A plain `.toISOString()` with no truncation. That is an instant; UTC is correct.
- Anything deliberately anchored to UTC, such as a value parsed as `'...T00:00:00Z'` and then walked
  in whole days. Converting one of those to LA **breaks** it.

If a site genuinely needs UTC — an external API that expects UTC bounds, say — mark it on that line
with `@utc-ok <reason>`. A reason is required; a bare marker is refused.

`greencross-command-center/tests/date_convention_test.js` enforces all of the above across every
`.gs` in the suite, and runs in the hub's push gate and CI.
