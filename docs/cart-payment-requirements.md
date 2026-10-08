# Cart, scheduling and payment requirements

Status: local unpaid-order implementation is available; real checkout/payment is deliberately disabled. Existing manual commerce and minimum tour lifecycle remain intact. No push/deploy performed. Merchant account is not yet opened. See `docs/ecommerce-local.md` for implemented behavior and remaining gates.

## Required features

- Tours: manual visibility and scheduled publish/unpublish timestamps; staff UI uses Pacific/Auckland timezone and stores UTC instants. Server time is authoritative.
- Payment configuration: full payment, fixed deposit or percentage deposit; per-tour settings and staff-assigned customer quote overrides. Show total, due now and outstanding balance separately. No fabricated deposit defaults.
- Customer cart: persist by authenticated customer ID, not browser-supplied identity. Authorized staff may add/edit/remove items for an existing registered customer. Record actor, timestamp, customer and change in audit history.
- Discounts: fixed NZD amount or percentage; validate and calculate server-side using integer cents. Define eligible items/customers, start/end validity, minimum spend and redemption limits. Never trust browser totals or mark paid from a return URL.
- Scheduling: reconcile cart on read, change, tab focus and time boundary; show removed/unavailable items and reason. Revalidate all items, quote expiry, price and coupons at checkout immediately before initiating payment.
- Private offers: distinguish discovery visibility from purchasing eligibility. Hiding a tour from public discovery must not inherently permit or forbid purchase. If private offers are supported, require an explicit customer-specific staff grant; use grant expiry and tour purchase window as independent constraints. Ordinary users must not gain access by guessing a slug.
- Checkout: create immutable pending order snapshot, idempotent payment initiation, provider reference, total/due/balance, and verified result reconciliation. Expired cart items cannot initiate payment. An already initiated/settled transaction needs separate reconciliation and refund/manual-review handling, not silent deletion.
- Merco/POLi: use provider-hosted payment; no bank login data on this site. Confirm current NZ integration API with Merco. Keep payments disabled until merchant setup, verified credentials and sandbox verification exist. Never generate a fake success response in place of a real provider interaction.

## Local policy decisions (payment remains disabled)

- Hidden tours need an explicit customer-specific expiring staff grant for cart/quote access; removal, purchase windows and deadlines remain independent gates.
- One coupon per quote; eligible total-price discounts apply before calculating deposits.
- Staff quotes lock unit cents until expiry; ordinary carts reprice from live tours. New unpaid orders require a matching current server quote hash and renewed review when amounts change.

## Safety and implementation gates

- Preserve existing dirty changes and real tours/customer data. Browser/test fixtures must use scratch storage.
- Current JSON/Blobs whole-record read-modify-write is not sufficient evidence of safe concurrent coupon redemption/payment processing. Introduce/verify durable atomic order/idempotency/redemption storage before enabling real payments.
- Staff assigned quotes require explicit permission and customer ownership checks on every endpoint.
- Test timezone/DST boundaries, expired scheduling, private visibility, customer isolation, staff permissions, coupon math/limits, changed prices, duplicate checkout/callback, forged return, provider outage and late settlement.
- Verify complete local API, admin and customer flow plus canonical build/test/i18n checks. Merchant integration remains blocked until provisioning and actual sandbox results.
