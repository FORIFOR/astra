# Movie, travel and delivery requests — 2026-09-13

reference : [TOHO vit](https://www.tohotheater.jp/vit/vit_buy.html) (showtime → seats → tickets → payment) and [McDelivery Japan](https://www.mcdonalds.co.jp/shop/mcdelivery/) (address/time → items → payment), checked 2026-09-13. Keep service names and the next concrete step visible.
hypothesis: Reuse Home's composer and one sheet for the three requested consumer journeys. Explicitly distinguish preparing a request, opening the official service, and a confirmed booking. No connected status or checkout success without an executor and receipt.
measured  : Current Home has three creation starters, no consumer entry, and the action lane returns “まだ自動では進められません” for movie reservations. Existing home content width is 760 pt, body 16 pt, secondary 14 pt, card padding 18 pt. Tokens remain unchanged.
candidates: A = generic unsupported action; B = three consumer links with no request context; C = one collapsed Home section, service-specific editable preparation, official-site handoff and optional travel research using the selected model. Adopt C for functional coverage, without a visual style change.
gate      : Unit tests for intent routing, missing conditions, official URL allowlist and personal-data minimization; native light/dark sheet renders and geometry; full verify-all before commit. Real purchase and payment are not part of this test run.

## Scope and evidence

These are preparation and official-site handoff journeys. No automatic checkout adapter exists for the three services in this version. Do not market them as completed automated bookings or orders.

Booking.com integrated checkout requires partner credentials: [authentication](https://developers.booking.com/demand/docs/development-guide/authentication), [orders preview/create](https://developers.booking.com/demand/docs/orders-api/overview). Credentials and final-price verification are separate from a normal web link.
