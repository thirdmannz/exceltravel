# Local unpaid-order commerce slice

Implemented locally; no deployment or push. This is **not a functioning payment processor**.

## Staff and customer flow

- `carts.manage` permits listing registered active customers and GET/PUT/DELETE `/api/staff-cart/:customerId`. Staff select a customer in Admin → 預訂與會員管理. Each assignment stores actor, customer, timestamp and before/after changes in the cart history; the shared audit also records the change.
- Hidden tours remain absent from public discovery. Staff may issue an explicit customer-bound expiring grant on an assigned cart item. Guessing the slug, sending another customer's grant, or passing a customer ID to the normal cart endpoint cannot grant access. Removing the cart item revokes that assignment.
- Grants do not bypass removal, aliases, booking deadlines, publication schedules or independent `purchaseStartAt`/`purchaseEndAt` gates. New Zealand tour schedule inputs store UTC. Staff grant/quote/coupon form fields explicitly accept UTC ISO instants.
- Per-tour `paymentPolicy` supports full, fixed per-person integer cents and percentage basis points. No deposit policy is guessed for existing tours. Staff quote overrides lock unit cents and policy until explicit expiry. Ordinary carts reprice from current tours.
- `coupons.manage` permits creating/listing coupons. A code has fixed cents or percentage basis points, start/end, minimum spend, allowed slugs/customer IDs, and maximum uses. One coupon applies before deposit calculation; all math uses integer cents and deterministic allocation. Codes are immutable through this minimum UI/API; create a new code rather than overwriting one.
- Customers review `/api/cart/quote`, then save `/api/orders` with the returned quote hash and idempotency key. Changed prices/policies/eligibility require fresh review. Order snapshots are stored in the same conditionally written customer cart record; ownership isolation and history survive tour/cart removal. Staff and customer UIs show unpaid order history.
- Order status is always `payment_disabled`, payment status `not_initiated`, provider reference null. Saving an unpaid order is neither payment initiation nor coupon redemption. Existing completed snapshots can be retrieved idempotently after expiry/removal without initiating payment.
- Cart reconciliation runs on read, changes, focus/tab visibility, server-provided next expiry boundary and a 30-second fallback. Server validation remains authoritative.

## Explicit payment gates / limitations

`POST /api/checkout` returns 503. No bank/card credentials, fake provider result, paid-return URL, callback settlement, inventory hold, recurring charge, refund or electronic ticket is implemented. A coupon maximum-use condition is checked against stored usage but unpaid snapshots do not increment it. Cross-customer atomic coupon redemption and payment initiation/settlement must be implemented with suitable durable transactions **before any real payments are enabled**. Conditional JSON/Blobs cart writes are tested, not proof of a multi-record payment transaction.

Staff quote/grant UI uses a slug input rather than a tour picker. This slice uses bilingual customer cart copy, not full Korean cart localization. Existing Google sign-in remains the real authentication path; browser fixtures use isolated preauthenticated sessions, not real credentials/customer records.

## Reproducible local proof

```
node --test tests/ecommerce-cart.test.js tests/cart.test.js tests/tour-lifecycle.test.js tests/tour-scheduling-timezone.test.js
npm test
npm run build
npm run i18n:scan
node scripts/scan-visible-language.js
git diff --check
```

For an isolated browser fixture: `npm run build && node tests/browser-fixture.js` (port 8876; scratch-backed JSON data). Visit `/__fixture__/identity?as=staff`, then `/admin/`; create a tour, assign to Alice, create a coupon. Switch fixture identity to `alice`, visit `/account.html`, review quote and save unpaid order. The fixture identity route exists **only in that test server**, not in either production adapter. Terminating it cleans its fixture storage.

Observed browser example: 2 × NZ$123.45, 10% coupon = NZ$222.21 total, 25% deposit = NZ$55.56 due now and NZ$166.65 balance. Saved order remained `payment_disabled`/`not_initiated`, null provider reference. Admin creation appeared immediately in EN public list/detail with localized booking link. Admin confirmed deletion emptied the public API and showed the EN not-found detail; historical unpaid order survived.
