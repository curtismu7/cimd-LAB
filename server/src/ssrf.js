import net from 'node:net';
import dns from 'node:dns/promises';

export class FetchRefused extends Error {
  constructor(check, message) {
    super(message);
    this.check = check;
  }
}

function ipv4Private(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19));
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return ipv4Private(ip);
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4Private(mapped[1]);
    const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return ipv4Private(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return true;
}

function isLoopbackName(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

// Fetch a metadata document the way a CIMD authorization server must: HTTPS, a public host, no
// redirects, a size cap, a timeout, JSON only. `allowLoopback` is the lab's one switch for serving its own
// fixtures over http on 127.0.0.1; it never opens any other private range.
// Known gap, said on the page: the host is resolved here and again by fetch, so a rebinding DNS answer
// could differ between the two. A production server pins the resolved address.
export async function fetchDocument(urlString, {
  fetchImpl = fetch,
  lookup = (host) => dns.lookup(host, { all: true }),
  allowLoopback = false,
  maxBytes = 5120,
  timeoutMs = 5000,
} = {}) {
  let url;
  try { url = new URL(urlString); } catch { throw new FetchRefused('not_a_url', 'client_id is not a URL'); }
  if (url.username || url.password) throw new FetchRefused('credentials_in_url', 'client_id must not carry credentials');
  const loopbackOk = allowLoopback && isLoopbackName(url.hostname) && url.protocol === 'http:';
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
