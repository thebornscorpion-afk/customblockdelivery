# sooperbrains Shiprocket delivery-estimator proxy

A single Vercel serverless function that proxies Shiprocket's courier serviceability API
for the product-page delivery-date estimator on sooperbrains.com.

**Why a proxy?** The Shiprocket credential stays server-side (never exposed in the
storefront's page source), and the function auto-refreshes the auth token so the feature
doesn't break on Shiprocket's ~10-day token expiry.

## Endpoint

```
GET /api/serviceability?pincode=560001[&weight=0.5][&cod=1]
```

Returns:

```json
{
  "serviceable": true,
  "pincode": "560001",
  "etd": "Jun 6, 2026",
  "estimated_days": "4",
  "courier_name": "Delhivery Surface",
  "cod_available": true
}
```

When the pincode isn't deliverable: `{ "serviceable": false, "pincode": "560001" }`.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `SHIPROCKET_EMAIL` | preferred | Account email — used to log in and auto-refresh the token |
| `SHIPROCKET_PASSWORD` | preferred | Account password |
| `SHIPROCKET_TOKEN` | fallback | Static bearer token (expires ~10 days; manual rotation) |
| `WAREHOUSE_PINCODE` | yes | Pickup pincode (6 digits) |
| `DEFAULT_WEIGHT` | no | Parcel weight in kg (default `0.5`) |
| `ALLOWED_ORIGINS` | recommended | Comma-separated CORS allowlist; default `*` |

## Deploy

```bash
npx vercel            # first run links/creates the project
npx vercel --prod     # production deploy
```

Set the environment variables in the Vercel dashboard (or via `npx vercel env add`),
then redeploy. Test with:

```bash
curl "https://<your-deployment>.vercel.app/api/serviceability?pincode=560001"
```
