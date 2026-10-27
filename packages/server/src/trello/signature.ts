import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Trello signs each delivery with base64(HMAC-SHA1(rawBody + callbackURL, appSecret)) in the
 * `x-trello-webhook` header. The body must be the raw bytes received and the callbackURL must be
 * exactly the URL that was registered.
 */
export function computeTrelloSignature(
  rawBody: string | Buffer,
  callbackUrl: string,
  secret: string,
): string {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
  return createHmac('sha1', secret)
    .update(Buffer.concat([body, Buffer.from(callbackUrl, 'utf8')]))
    .digest('base64');
}

export interface VerifyTrelloSignatureInput {
  rawBody: string | Buffer;
  callbackUrl: string;
  secret: string;
  header: string | string[] | undefined;
}

export function verifyTrelloSignature(input: VerifyTrelloSignatureInput): boolean {
  const header = Array.isArray(input.header) ? input.header[0] : input.header;
  if (!header) return false;
  const expected = Buffer.from(
    computeTrelloSignature(input.rawBody, input.callbackUrl, input.secret),
    'utf8',
  );
  const given = Buffer.from(header, 'utf8');
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
