// ============================================================
//  middleware/rateLimit.js — small in-memory abuse guard
//
//  Fixed-window counters kept per process. On Vercel each function
//  instance has its own map, so this is a best-effort brake on
//  credential stuffing / mass sign-up — not a global WAF rule.
//
//  clientIp(): behind Vercel the socket address is the proxy, so we
//  read the platform-provided x-forwarded-for / x-real-ip. Direct
//  connections (self-host / LAN) use the real socket address.
// ============================================================
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const hits = new Map();

function clientIp(req) {
  if (process.env.VERCEL) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return fwd || req.headers['x-real-ip'] || req.socket?.remoteAddress || '?';
  }
  return req.socket?.remoteAddress || '?';
}

function rateLimit({ windowMs = WINDOW_MS, max = 10, name = 'limit', key } = {}) {
  const keyOf = key || ((req) => clientIp(req));
  return (req, res, next) => {
    // test/CI escape hatch: the suites fire many auth calls from one IP
    if (process.env.ISIGK_NO_RATELIMIT === '1') return next();
    const k = `${name}:${keyOf(req)}`;
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || now - entry.start >= windowMs) {
      entry = { start: now, count: 0 };
      hits.set(k, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many attempts — please try again later' });
    }
    next();
  };
}

// periodic cleanup so the map never grows without bound
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of hits) if (now - e.start >= WINDOW_MS) hits.delete(k);
}, WINDOW_MS).unref?.();

module.exports = { rateLimit, clientIp };
