# Inquiry email notifications

All website submissions using `POST /api/inquiries` (contact/chat/booking inquiry) are saved before a best-effort email notification. Local runners and the Netlify function use `lib/inquiry-notify.js`.

Default recipients:

- sophie@excel2012.com
- lala.liang@excel2011.com
- jessica.zhang@excel2011.com
- sandy.kim@excel2011.com

Notifications include the full accepted message, name, customer email, phone, page, tour context, inquiry ID and timestamp. The customer's email is the Reply-To address. Honeypot/invalid submissions do not send notifications.

## Activation requirements

- Set `RESEND_API_KEY` through secure environment configuration.
- Set `INQUIRY_FROM_EMAIL` to a sender/domain verified by Resend. The Netlify fallback `onboarding@resend.dev` is for provider onboarding and does not establish delivery to these four recipients.
- Saved Admin → Contact notification recipients take priority. Without a saved list, `INQUIRY_NOTIFY_EMAIL` (comma-separated) or legacy `NOTIFY_EMAIL` is the fallback; without either, the four defaults apply.
- No deployment is performed by this change. Existing deployed code and environment remain unchanged.

## Failure behavior and verification

Provider rejection or network failure does not mark notification sent and does not discard the saved inquiry. This is best-effort sending, not a durable retry queue or proof of inbox delivery. Inquiry records remain available in Admin even if email delivery fails.

`node --test tests/inquiry-notify.test.js` verifies all four recipients, full content, Reply-To, overrides, provider failures and API save-before-send using intercepted requests. No real email is sent by tests. Real provider acceptance and recipient inbox delivery require the sender/key setup and an authorized live verification.
