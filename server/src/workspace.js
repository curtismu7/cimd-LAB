import crypto from 'node:crypto';

// Workspace id: the key for every piece of per-visitor state (pending requests, codes, Reset).
// Local mode: one workspace, from WORKSPACE or "default". Hosted mode: one per browser, carried in a signed
// cookie that only this process can mint; the id is never read from a query, body or any other header.
export const COOKIE = 'cimd_ws';
export const WORKSPACE_PATTERN = /^[A-Za-z0-9_-]{22,43}$/;
const LOCAL_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ID_LEN = 22; // 16 random bytes, base64url
const SIG_LEN = 16;
const MAX_COOKIE_HEADER = 4096;
export const MAX_WORKSPACES = 500;
export const MAX_AGE_S = 24 * 60 * 60;

export const isLoopbackAddress = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(address ?? ''));

export function createWorkspaces({ hosted, local = 'default', max = MAX_WORKSPACES, now = Date.now, onEvict = () => {} } = {}) {
  const localId = LOCAL_PATTERN.test(String(local ?? '')) ? String(local) : 'default';
  const secret = crypto.randomBytes(32);
  const sign = (id) => crypto.createHmac('sha256', secret).update(id).digest('base64url').slice(0, SIG_LEN);
  const live = new Map(); // id -> last used; insertion order = least recently used first
  const internal = new Map(); // one-run tokens the tester presents on its own loopback calls

  const touch = (id) => {
    live.delete(id);
    live.set(id, now());
    while (live.size > max) {
      const oldest = live.keys().next().value;
      live.delete(oldest);
      onEvict(oldest);
    }
  };

  function fromCookie(header) {
    if (typeof header !== 'string' || header.length > MAX_COOKIE_HEADER) return null;
    for (const part of header.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name !== COOKIE) continue;
      const value = rest.join('=');
      if (!WORKSPACE_PATTERN.test(value) || value.length !== ID_LEN + SIG_LEN) return null;
      const id = value.slice(0, ID_LEN);
      const given = Buffer.from(value.slice(ID_LEN));
      const want = Buffer.from(sign(id));
      return given.length === want.length && crypto.timingSafeEqual(given, want) ? id : null;
    }
    return null;
  }

  const cookieFor = (id, secure) => `${COOKIE}=${id}${sign(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_S}${secure ? '; Secure' : ''}`;

  // Sets req.workspaceId (and the cookie, hosted only). Registers nothing: a workspace is counted only once
  // it holds state (touch), so visitors who never start a request cannot push others out.
  function middleware(req, res, next) {
    const grant = req.headers['x-cimd-internal'];
    if (typeof grant === 'string' && isLoopbackAddress(req.socket.remoteAddress) && internal.has(grant)) {
      req.workspaceId = internal.get(grant);
      return next();
    }
    if (!hosted) { req.workspaceId = localId; return next(); }
    let id = fromCookie(req.headers.cookie);
    if (!id) {
      id = crypto.randomBytes(16).toString('base64url');
      const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',').at(-1).trim();
      res.append('Set-Cookie', cookieFor(id, proto === 'https'));
    }
    req.workspaceId = id;
    return next();
  }

  // Tester: a run gets a token that maps to the caller's workspace, valid until the run ends.
  function grantInternal(workspaceId) {
    if (internal.size >= 100) throw new Error('too many runs');
    const grant = crypto.randomBytes(24).toString('base64url');
    internal.set(grant, workspaceId);
    return { grant, revoke: () => internal.delete(grant) };
  }

  return { middleware, touch, grantInternal, size: () => live.size, has: (id) => live.has(id), localId };
}
