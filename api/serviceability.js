// Shiprocket serviceability proxy for the sooperbrains.com delivery-date estimator.
//
// The Shiprocket credential lives only in Vercel environment variables — it is never
// sent to the browser. Prefer SHIPROCKET_EMAIL + SHIPROCKET_PASSWORD: the function logs
// in and caches the token (valid ~240h) so the feature never breaks on token expiry.
// Falls back to a static SHIPROCKET_TOKEN if that is all you have.
//
// Env vars (set in Vercel → Project → Settings → Environment Variables):
//   SHIPROCKET_EMAIL      Shiprocket account email      (preferred)
//   SHIPROCKET_PASSWORD   Shiprocket account password   (preferred)
//   SHIPROCKET_TOKEN      Static bearer token           (fallback, expires ~10 days)
//   WAREHOUSE_PINCODE     Pickup pincode (6 digits)     (required)
//   DEFAULT_WEIGHT        Default parcel weight in kg   (optional, default "0.5")
//   ALLOWED_ORIGINS       Comma-separated CORS allowlist (optional, default "*")
//
// Request:  GET /api/serviceability?pincode=560001[&weight=0.5][&cod=1]
// Response: { serviceable, pincode, etd, estimated_days, courier_name, cod_available }

const SHIPROCKET_BASE = 'https://apiv2.shiprocket.in/v1/external';

// In-memory token cache. Persists while the serverless instance stays warm, so most
// requests reuse the token instead of re-authenticating.
let cachedToken = null;
let cachedTokenExpiry = 0; // epoch ms

function allowlist() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveAllowedOrigin(reqOrigin) {
  const allowed = allowlist();
  if (allowed.length === 0) return '*';
  if (reqOrigin && allowed.includes(reqOrigin)) return reqOrigin;
  return allowed[0];
}

async function getToken() {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;

  // Preferred path: log in with email/password and cache the returned token.
  if (email && password) {
    if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

    const res = await fetch(`${SHIPROCKET_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Shiprocket login failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    if (!data.token) throw new Error('Shiprocket login returned no token');

    cachedToken = data.token;
    // Tokens last ~240h; refresh a day early to stay safe.
    cachedTokenExpiry = Date.now() + 9 * 24 * 60 * 60 * 1000;
    return cachedToken;
  }

  // Fallback: static token (will need manual rotation every ~10 days).
  if (process.env.SHIPROCKET_TOKEN) return process.env.SHIPROCKET_TOKEN;

  throw new Error(
    'No Shiprocket credentials configured. Set SHIPROCKET_EMAIL + SHIPROCKET_PASSWORD, or SHIPROCKET_TOKEN.'
  );
}

function pickCourier(couriers, recommendedId) {
  if (!Array.isArray(couriers) || couriers.length === 0) return null;
  if (recommendedId) {
    const rec = couriers.find((c) => c.courier_company_id === recommendedId);
    if (rec) return rec;
  }
  // Otherwise return the fastest courier by estimated delivery days.
  return couriers.slice().sort((a, b) => {
    const da = parseFloat(a.estimated_delivery_days) || 999;
    const db = parseFloat(b.estimated_delivery_days) || 999;
    return da - db;
  })[0];
}

function readQuery(req) {
  if (req.query && Object.keys(req.query).length) return req.query;
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    return Object.fromEntries(url.searchParams);
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', resolveAllowedOrigin(req.headers.origin));
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const q = readQuery(req);
  const deliveryPincode = String(q.pincode || q.delivery_postcode || '').replace(/\D/g, '');
  const pickupPincode = String(q.pickup || process.env.WAREHOUSE_PINCODE || '').replace(/\D/g, '');
  const weight = String(q.weight || process.env.DEFAULT_WEIGHT || '0.5');
  const cod = String(q.cod) === '1' ? 1 : 0;

  if (deliveryPincode.length !== 6) {
    res.status(400).json({ error: 'Enter a valid 6-digit pincode', serviceable: false });
    return;
  }
  if (pickupPincode.length !== 6) {
    res.status(500).json({ error: 'Warehouse pincode not configured (set WAREHOUSE_PINCODE)' });
    return;
  }

  try {
    const token = await getToken();
    const qs = new URLSearchParams({
      pickup_postcode: pickupPincode,
      delivery_postcode: deliveryPincode,
      weight,
      cod: String(cod),
    });

    const srRes = await fetch(`${SHIPROCKET_BASE}/courier/serviceability/?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // A stale/invalid token: bust the cache so the next warm request re-authenticates.
    if (srRes.status === 401 || srRes.status === 403) {
      cachedToken = null;
      cachedTokenExpiry = 0;
      const text = await srRes.text().catch(() => '');
      res.status(502).json({ error: 'Shiprocket auth rejected', detail: text, serviceable: false });
      return;
    }

    const data = await srRes.json().catch(() => ({}));
    const couriers = data?.data?.available_courier_companies || [];
    const courier = pickCourier(couriers, data?.data?.recommended_courier_company_id);

    // Light CDN cache: cuts repeat Shiprocket calls without letting the date drift much.
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');

    if (!courier) {
      res.status(200).json({ serviceable: false, pincode: deliveryPincode });
      return;
    }

    res.status(200).json({
      serviceable: true,
      pincode: deliveryPincode,
      etd: courier.etd || null, // e.g. "Jun 6, 2026"
      estimated_days: courier.estimated_delivery_days || null,
      courier_name: courier.courier_name || null,
      cod_available: courier.cod === 1 || courier.cod === true,
    });
  } catch (err) {
    res.status(502).json({
      error: 'Serviceability lookup failed',
      detail: String((err && err.message) || err),
      serviceable: false,
    });
  }
}
