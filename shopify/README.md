# Shopify theme files (delivery estimator)

These are the storefront files for the delivery-date estimator. They are **deployed to
Shopify**, not to Vercel — kept here only for version control / backup.

Deployed via the Admin Asset API to the **"May theme"** (unpublished, id `146123849807`)
of the Sooper Brains store (`xade8d-0t.myshopify.com`) on 2026-06-02.

| File | Theme asset key | Notes |
|---|---|---|
| `snippets/delivery-estimator.liquid` | `snippets/delivery-estimator.liquid` | UI + vanilla JS; calls the Vercel proxy. No credentials. |
| `blocks/delivery-estimator.liquid` | `blocks/delivery-estimator.liquid` | Draggable theme block + schema/presets. |
| `sections/main-product.liquid` | `sections/main-product.liquid` | Adds `{ "type": "delivery-estimator" }` after `_product_buy-buttons`. |

The block's `proxy_url` setting points at the Vercel deployment
(`https://customblockdelivery.vercel.app`); the Shiprocket credential lives only in
Vercel env vars and is never exposed on the storefront.

> Note: this theme's section schema rejects a `"limit"` attribute on a theme-block
> reference, so the block entry omits it.
