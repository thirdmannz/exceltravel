# Manual bookings and membership operations

## Current scope

This release is a **manual operations backend**, not ecommerce checkout.
It uses the existing local JSON / Netlify Blobs adapters. No payment provider,
card collection, inventory reservation, electronic tickets, automatic renewal,
email marketing delivery or paid-content entitlement enforcement is enabled.

## Staff workflow

1. Open Admin → 預訂與會員管理. Give staff `bookings.view/manage` and/or
   `memberships.view/manage` in 帳號與權限. Admin has all permissions.
2. Bookings originate from `booking.html` → `/api/inquiries`. New submissions
   include departure date, adults, children and room as structured data. Existing
   tour inquiries remain visible without copying or parsing their message text.
3. Record quote and requested deposit in NZD; progress through requested, quoted,
   confirmed, completed or cancelled. Confirmation **does not mean paid**.
4. Create membership plans with reference price and month/year/once interval;
   enable a plan for staff entry, then create a member record. Active manual
   records require start and end dates. These records do not grant site access.
5. Search, refresh and export CSV. Exports are UTF-8 with BOM, quoted fields and
   spreadsheet-formula neutralization. Internal notes are included: treat exports
   as confidential customer data.

## Storage and safety

- Booking records remain in `inquiries.json`; membership plans and members use
  `memberships.json` (`{ plans: [], members: [] }`). No seeded commercial plans or
  invented prices are created.
- New route permissions are checked server-side. Unknown fields, payment status,
  invalid monetary values, duplicate active member/plan entries and invalid dates
  are rejected. Money is stored in integer NZD cents.
- Revisions reject stale sequential edits with HTTP 409; this is **not an atomic
  compare-and-swap**. Blobs whole-document writes can still race across instances.
  Use one operator at a time until migration to a transactional database.
- Inquiry storage at 1,000 records rejects new entries with HTTP 503 rather than
  deleting old booking history. Back up and arrange archival before capacity.
- Booking/membership read failures fail closed rather than overwriting old data
  with an empty list. Mutating browser requests reject foreign origins.
- Changes include actor/timestamp/revision and existing audit trail. The audit
  store itself is not transactional with records.

## Before real sales / recurring billing

Use a transaction-capable database, trusted server-side prices, inventory locks,
idempotent order creation and verified signed payment webhooks. Decide merchant,
provider, GST/receipts, cancellation/refund terms, privacy/consent, membership
benefits and renewal policy. Add real customer order access and ticket fulfilment
only after that. Do not infer payment success from browser redirects or staff
status changes. No public paid-membership sign-up is added in this release.

## Verification

Run `npm run build`, `npm test`, `npm run i18n:scan`,
`node scripts/scan-visible-language.js`, and `git diff --check` locally.
Tests use isolated storage; the manual Admin browser smoke test used an ephemeral
in-memory HTTP fixture, not production credentials or customer records.
Deployment requires separate explicit authorization to preserve Netlify quota.
