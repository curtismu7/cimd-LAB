// Documents the lab serves about itself. `good` is the lab's own client document; the others each break
// one rule, so the server tester (and a real authorization server) can be shown the refusal.
// `base` is the origin that serves them, with no trailing slash.

export const FIXTURE_PATH = '/fixtures';

export function fixtureUrl(base, name) {
  return `${base}${FIXTURE_PATH}/${name}.json`;
}

const GOOD_CALLBACK = (base) => `${base}/callback`;

export function goodDocument(base, name = 'good') {
  return {
    client_id: fixtureUrl(base, name),
    client_name: 'CIMD Lab test client',
    client_uri: base,
    redirect_uris: [GOOD_CALLBACK(base)],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

// name -> { title, rule, serve: (base) => { body, contentType?, status?, headers? } }
export const FIXTURES = {
  good: {
    title: 'A correct document',
    rule: 'valid',
    serve: (base) => ({ body: goodDocument(base) }),
  },
  'client-id-mismatch': {
    title: 'client_id inside the document is another URL',
    rule: 'client_id_mismatch',
    serve: (base) => ({ body: { ...goodDocument(base), client_id: fixtureUrl(base, 'good') } }),
  },
  'shared-secret': {
    title: 'Asks for a shared client secret',
    rule: 'shared_secret',
    serve: (base) => ({ body: { ...goodDocument(base, 'shared-secret'), token_endpoint_auth_method: 'client_secret_basic' } }),
  },
  'secret-in-document': {
    title: 'Publishes a client_secret',
    rule: 'shared_secret',
    // A made-up value: the point is that a public document must not hold one at all.
    serve: (base) => ({ body: { ...goodDocument(base, 'secret-in-document'), client_secret: 'not-a-real-secret' } }),
  },
  oversize: {
    title: 'Document larger than the fetch cap',
    rule: 'too_large',
    serve: (base) => ({ body: { ...goodDocument(base, 'oversize'), client_name: 'x'.repeat(6000) } }),
  },
  'not-json': {
    title: 'Served as plain text',
    rule: 'not_json',
    serve: () => ({ body: 'not a document', contentType: 'text/plain' }),
  },
  redirects: {
    title: 'Answers with a redirect',
    rule: 'redirected',
    serve: (base) => ({ status: 302, headers: { Location: fixtureUrl(base, 'good') }, body: '' }),
  },
};
