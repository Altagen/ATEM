# Sheets waiting for their screen

These sheets come from the earlier prototype and **are not loaded**: no `@import` references
them, so they add nothing to the shipped bundle.

They wait for the screen they style:

| Sheet | Screen | Milestone |
|---|---|---|
| `components.css` | The mock-up's component library — taken so far: `.pwd-*` in `design/password-meter.css`, the buttons, fields and counted field in `design/components/controls.css`, the data table in `design/components/table.css`, the identity badges and avatar picker in `design/components/identity.css` | — |
| `shared-nav.css` | Inbox, mobile account panel, pager | M3–M4 |

`settings.css` went up on 2026-09-17 with the settings screen, and its export,
import and history panels since.
`pages/profile.css` went up on 2026-09-17 with the profile screen, with the
avatar and role badges, the avatar picker and the counted field from
`components.css`.

`pruned/` holds the rules the dead-CSS purge removed from the shipped sheets,
one file per sheet. When a screen brings back the markup such a rule styles,
the rule moves back up into its sheet.

Staging them here rather than importing them right away is deliberate: a sheet
loaded without its markup is dead CSS, and `scripts/check-dead-css.mjs` would
rightly report it. When the screen arrives, the sheet moves up a level and its
`@import` is added to `design/index.css`.
