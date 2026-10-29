import net from 'node:net';
import dns from 'node:dns/promises';

export class FetchRefused extends Error {
  constructor(check, message) {
    super(message);
    this.check = check;
  }
}

function ipv4Private(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

// Expand an IPv6 literal to its 8 16-bit groups (a trailing dotted IPv4 counts as two groups). null when it is not one.
function parseIpv6(ip) {
  if (ip.includes('%')) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const toGroups = (text) => {
    if (text === '') return [];
    const out = [];
    const parts = text.split(':');
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (part.includes('.')) {
        if (i !== parts.length - 1 || !net.isIPv4(part)) return null;
        const [a, b, c, d] = part.split('.').map(Number);
        out.push((a << 8) | b, (c << 8) | d);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
        out.push(parseInt(part, 16));
      }
    }
    return out;
  };
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array(fill).fill(0), ...tail];
}

const v4Of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function ipv6Private(ip) {
  const g = parseIpv6(ip);
  if (!g) return true; // anything that does not parse is refused
  const zero = (from, to) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 6)) return true; // ::, ::1 and the IPv4-compatible ::a.b.c.d / ::x:y range
  if (zero(0, 5) && g[5] === 0xffff) return ipv4Private(v4Of(g[6], g[7])); // IPv4-mapped
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return true; // SIIT ::ffff:0:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g[2] === 1) return true; // 64:ff9b:1::/48 local-use NAT64: never public
    if (zero(2, 6)) return ipv4Private(v4Of(g[6], g[7])); // 64:ff9b::/96 NAT64
  }
  if (g[0] === 0x2002) return ipv4Private(v4Of(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return ipv4Private(ip);
  if (net.isIPv6(ip)) return ipv6Private(ip);
  return true;
}

// Fetch a metadata document the way a CIMD authorization server must: HTTPS, a public host, no
// redirects, a size cap, a timeout, JSON only. `allowLoopback` is the lab's one switch for fetching its own
// fixtures: it opens exactly `loopbackOrigin` (http://127.0.0.1:<its own port>) and only paths under
// `loopbackPathPrefix`; any other loopback port or path is refused like any other http URL.
// Known gap, said on the page: the host is resolved here and again by fetch, so a rebinding DNS answer
// could differ between the two. A production server pins the resolved address.
export async function fetchDocument(urlString, {
  fetchImpl = fetch,
  lookup = (host) => dns.lookup(host, { all: true }),
  allowLoopback = false,
  loopbackOrigin = null,
  loopbackPathPrefix = '/fixtures/',
  maxBytes = 5120,
  timeoutMs = 5000,
} = {}) {
  let url;
  try { url = new URL(urlString); } catch { throw new FetchRefused('not_a_url', 'client_id is not a URL'); }
  if (url.username || url.password) throw new FetchRefused('credentials_in_url', 'client_id must not carry credentials');
  const loopbackOk = allowLoopback && Boolean(loopbackOrigin) && url.protocol === 'http:'
    && url.origin === loopbackOrigin && url.pathname.startsWith(loopbackPathPrefix);
  if (url.protocol !== 'https:' && !loopbackOk) throw new FetchRefused('not_https', 'client_id must be an HTTPS URL');

  if (!loopbackOk) {
    const literal = url.hostname.replace(/^\[|\]$/g, '');
    let addresses;
    if (net.isIP(literal)) addresses = [{ address: literal }];
    else {
      try { addresses = await lookup(url.hostname); } catch { throw new FetchRefused('unresolvable_host', 'The host did not resolve'); }
    }
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new FetchRefused('private_host', 'The host is not a public address');
    }
  }

  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'manual',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new FetchRefused('fetch_failed', 'The document could not be fetched');
  }
  if (response.status >= 300 && response.status < 400) throw new FetchRefused('redirected', 'Redirects are not followed');
  if (response.status !== 200) throw new FetchRefused('fetch_status', `The document answered HTTP ${response.status}`);
  if (!/json/i.test(response.headers.get('content-type') ?? '')) throw new FetchRefused('not_json', 'The document is not served as JSON');

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchRefused('too_large', `The document is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new FetchRefused('not_json', 'The document is not valid JSON');
  }
}
