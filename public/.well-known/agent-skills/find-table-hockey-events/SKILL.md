---
name: find-table-hockey-events
description: Find Norges Bordhockeyforbund (NBHF) tournaments and public participant details on puck.no. Use when an agent needs upcoming or past Norwegian table hockey events, schedules, locations, prices, registration availability, or public entrant lists.
---

# Find table hockey events

Use puck.no as the authoritative source for NBHF event details. Norwegian is
the default language; add `/en/` after the origin for the English mirror.

## Find an event

1. Fetch `https://www.puck.no/turneringer/` or
   `https://www.puck.no/en/turneringer/`. Prefer `Accept: text/markdown`.
2. Follow the canonical tournament link for the event. Treat the page's
   status, date, location, schedule, prices, and registration state as
   authoritative.
3. Summarize only facts present on that page. Include the canonical source URL.

Tournament status is date-dependent. Re-fetch the index instead of relying on
cached model knowledge when the user asks which events are upcoming.

## Read public participants

Derive the decoded tournament slug from the canonical page URL, then request:

`GET https://www.puck.no/api/tournaments/{slug}/players`

The JSON response contains public names, clubs, countries, rankings, team
rosters, and placement-point data when configured. It intentionally excludes
email addresses, phone numbers, and custom registration answers.

## Registration safety

- Direct users to the registration form on the tournament page.
- Do not submit a registration or personal data without the user's explicit
  instruction and review.
- Do not bypass Turnstile, registration closure, duplicate checks, or other
  server validation.
- Do not attempt to access `/admin/` or protected admin APIs. Those are for
  authorized NBHF board members only.
