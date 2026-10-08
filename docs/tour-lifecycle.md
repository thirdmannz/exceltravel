# Minimum tour lifecycle

- Admin → 行程管理 → ＋ 新增行程 uses the existing Chinese/English/Korean form. Name and category are required by the form. Saving immediately makes the tour public; this slice has no separate draft/publish workflow.
- `POST /api/tours` requires `tours.create`. It accepts the existing editable content fields, generates a unique ASCII `slug`/`slugEn`, and returns 201. Explicit unsafe slugs return 400 and collisions return 409. `tours.create` allows setting initial content; subsequent PUTs still require the existing field-level edit permissions.
- `DELETE /api/tours/:slug` requires `tours.delete`. It marks the tour and direct aliases `removed: true`; removed URLs stay reserved. It does not delete uploaded images or historical inquiry/booking records. Repeated deletion and updates of removed records return 404.
- Admins receive both permissions automatically. The editor preset includes them for newly assigned roles. Existing editors with stored explicit permission lists need the two permissions granted under account management; permissions are not silently migrated.
- New tours use `dynamic: true` and link to `/tour.html?slug=…&lang=en|ko|zh`, so their detail page works before a static rebuild. Booking links retain the selected tour and language.
- Public lists, homepage cards, booking selection and detail hydration use the live API with `cache: no-store`. A successful empty response clears stale prerendered content. A failed API call deliberately keeps the prebuilt snapshot readable.
- Builds exclude removed tours from pages, sitemap and text mirrors; legacy redirect generation skips removed tours and aliases. `EXCELTRAVEL_TOURS=/absolute/path/to/fixture.json` supplies isolated build data for tests.

## Limitations

This is public creation/removal, not a draft/approval workflow. Removing a tour does not erase old deployed HTML without rebuilding; with a healthy API the browser replaces that content with the not-found view. If the API is offline or JavaScript is disabled, an old static snapshot can remain readable. Runtime removal is not an HTTP 410 or a confidentiality boundary. No translations are automatically generated.

## Verification

`node --test tests/tour-lifecycle.test.js` exercises lifecycle, permissions, CSRF, validation/collisions, aliases, booking history, denied-update atomicity, live-empty versus outage fallback, dynamic links and isolated publishing. Run the full maintenance verification loop before deployment. Browser checks should use a separate scratch-backed local fixture server, never real customer data.
