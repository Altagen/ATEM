# Sheets waiting for their screen

These sheets come from ATEM-old and **are not loaded**: no `@import` references
them, so they add nothing to the shipped bundle.

They wait for the screen they style:

| Sheet | Screen | Milestone |
|---|---|---|
| `settings.css` | Account settings, import/export | M3 |
| `pages/profile.css` | A player's public profile | M4 |
| `components.css` | The mock-up's component library — only its `.pwd-*` rules are taken, in `design/password-meter.css` | — |
| `shared-nav.css` | Inbox, mobile account panel, pager | M3–M4 |

`pruned/` holds the rules the dead-CSS purge removed from the shipped sheets,
one file per sheet. When a screen brings back the markup such a rule styles,
the rule moves back up into its sheet.

Staging them here rather than importing them right away is deliberate: a sheet
loaded without its markup is dead CSS, and `scripts/check-dead-css.mjs` would
rightly report it. When the screen arrives, the sheet moves up a level and its
`@import` is added to `design/index.css`.
