import { describe, expect, it } from 'vitest';
import { computeTrelloSignature, verifyTrelloSignature } from '../../src/trello/signature';

const body = '{"a":1}';
const url = 'https://example.test/webhooks/trello/abc';
const secret = 'secret';
// Known answer computed once with: base64(HMAC-SHA1(body + url, secret))
const KNOWN = 'Db3FrbRIkjjXrCfYYfhhS78Xe44=';

describe('trello signature', () => {
  it('matches the known answer', () => {
    expect(computeTrelloSignature(body, url, secret)).toBe(KNOWN);
    expect(verifyTrelloSignature({ rawBody: body, callbackUrl: url, secret, header: KNOWN })).toBe(
      true,
    );
  });

  it('accepts the body as a Buffer', () => {
    expect(
      verifyTrelloSignature({
        rawBody: Buffer.from(body),
        callbackUrl: url,
        secret,
        header: KNOWN,
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(
      verifyTrelloSignature({ rawBody: '{"a":2}', callbackUrl: url, secret, header: KNOWN }),
    ).toBe(false);
  });

  it('rejects a different callback URL', () => {
    expect(
      verifyTrelloSignature({ rawBody: body, callbackUrl: url + '/', secret, header: KNOWN }),
    ).toBe(false);
  });

  it('rejects a wrong secret, a missing header and a header of the wrong length', () => {
    expect(
      verifyTrelloSignature({ rawBody: body, callbackUrl: url, secret: 'other', header: KNOWN }),
    ).toBe(false);
    expect(
      verifyTrelloSignature({ rawBody: body, callbackUrl: url, secret, header: undefined }),
    ).toBe(false);
    expect(
      verifyTrelloSignature({ rawBody: body, callbackUrl: url, secret, header: 'short' }),
    ).toBe(false);
  });
});
