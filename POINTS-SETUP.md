# Attendance and points

The admin Attendance page includes the points dashboard. All point writes require
Firebase connectivity; there is no local-only success fallback.

## Activation

1. In Firebase Authentication, identify the existing administrator account UIDs.
2. In the Realtime Database console, create `pointsAdmins/<UID>` with boolean
   `true` for each administrator. This allowlist cannot be edited through the app.
   Accounts with an existing boolean `admin` custom claim also have access.
3. Deploy `database.rules.json` to the project's Realtime Database.
4. Publish `index.html`, `points.js`, `points-core.js`, and `points.css` together
   through the website's existing hosting workflow.

The repository's older attendance rules permit any authenticated user. The new
points records use the explicit allowlist/custom claim instead. Hiding a button
or changing localStorage does not grant points access.

## First use

Member Settings includes an admin-controlled Senior Benefit for the specific
school year being viewed. Enable it only for a qualifying senior and enter their
reduced requirement. It does not depend on club year, transfer to another year,
or change earned points. Disabling it restores the ordinary requirement. Sponsor
reports include the benefit flag and effective required points. Exemption and
Senior Benefit cannot both be enabled; a benefit cannot increase a normal target.

Import the saved scanner roster, add members, or approve newly scanned names.
Members use a first school year in the club, not their school grade.
Year Settings supports meeting credit and requirements by club year (first through
fourth). Defaults of 15/12/12/12 are editable assumptions from
the supplied spreadsheet, not a confirmed club policy. Set individual targets
or exemptions in Member Settings. No automatic board exemption is assumed.

Import Balances accepts CSV with `name,points,identity,status,category,joinedyear` columns;
only name and points are required. Example:

```csv
name,points,identity,status,category,joinedyear
Example Member,5.5,example@school.edu,Member,service,2026-2027
```

Export one school year's balances at a time, using this column layout. A preview
is shown before import. Existing members match by identity when supplied, or by
exact normalized name. Ambiguous matches fail. Existing yearly histories cannot
be overwritten by an import. A member's ID persists independently of their name.

After scanning, correct the detected names and choose Review & Award Points.
Match each row to a member, add it as a new member, or exclude it. Check the
verification box and approve. Unmatched names default to creating a new member;
ambiguous existing names require explicit selection. Approvals and awards are committed in
one Firebase transaction. Approved Meetings holds verified member lists separately
from the old scanner archive, which prunes historical scans. Legacy scans do not
receive points automatically.

Use the same date and title for multiple pages or retries of the same meeting.
The date, normalized title, and school year identify a meeting. Renaming a meeting
creates a distinct meeting, so admins must keep these values consistent. Repeated
approvals skip already credited members, including corrected awards. Changing the
default meeting credit affects new meetings only.

Scans award participation points. Manual additions default to service, with a
participation option. Corrections append negative entries with required reasons
and cannot bring a category below zero. Existing scans are interpreted as
participation and old manual additions as service. Historical imports and
corrections without categories remain explicitly unclassified; no uncertain
legacy balance is silently assigned to a category.

School years roll over automatically on August 1 in America/New_York. The page
checks rollover every 30 seconds and on visibility changes. Scans are assigned
using their meeting date, independently of the year selected for viewing. Closed
years require explicit admin confirmation to add attendance or adjustments.
Previous entries are never moved into the next club year.

Each member shows First Year through Fourth Year point buttons. Clicking one
opens participation and service totals and their separate histories. Active
members disappear when their fifth school year starts (four club school years,
not four years measured from the exact signup date). Their history is retained
for sponsors and is accessible through Show graduated members. A historical
school-year selection shows members active in that school year. Sorting uses
combined club points through the selected year's end; exactly one combined point
renders text at 60% opacity. Two or more points use full text opacity.

Existing member joining years are inferred from the earliest recorded year or
profile and stabilized on the next save. Members without dates default to the
current year. Admins can correct the first school year in Member Settings, provided
all existing entries still fit within four club years.

Download Report exports a spreadsheet-compatible CSV with participation, service,
unclassified legacy points, all four club-year totals, and the combined total.
Select a cutoff date, such as the last day of a month, for cumulative monthly
sponsor reporting. Activity after the cutoff is excluded; later corrections to
earlier activity are included. Graduates remain in exports for their historical
active school years. Exports are reports, not the opening-balance import format.

All entries record the actor UID and timestamp. Deleting an old scanner record
does not delete points. The scanner worker must also be published for the updated
transcription prompt, which preserves new names rather than forcing roster matches.

## Verification

Run `node --test points.test.cjs` and `node --check points.js`.
Browser interaction checks use a mocked Firebase transaction store; production
permissions, actual concurrent clients, and deployment need live integration
verification.

## Production deployment (2026-09-07)

Published the website to `https://northgwinnettcshs.pages.dev` and the existing
Firebase Hosting site `https://ng-cshs-website.web.app`. Published scanner Worker
version `3a50d61d-67c5-461b-86e9-52e553397966` and released the Realtime Database
rules. Granted points access to the existing `northgwinnettcshs@gmail.com` Firebase
admin account. No new accounts or member point records were created.

Verified production file contents, page initialization without JavaScript errors,
scanner health and API-key presence, cross-origin preflight, unauthenticated
scanner rejection, private points-data denial, and the admin allowlist entry.
An authenticated handwriting scan has not been run as part of deployment.
Deployment logs, database rules, tests, and setup notes are excluded from hosting.
