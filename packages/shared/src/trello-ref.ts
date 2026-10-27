export interface TrelloBoardRef {
  /** Either a 24-hex board id or an 8-character short link. Both work with the Trello API. */
  idOrShortLink: string;
}

const HEX_ID = /^[0-9a-f]{24}$/i;
const SHORT_LINK = /^[A-Za-z0-9]{8}$/;

/**
 * Accepts a board URL (https://trello.com/b/AbCd1234/board-name), a short link (AbCd1234)
 * or a 24-hex id. Throws on anything else.
 */
export function parseTrelloBoardRef(input: string): TrelloBoardRef {
  const trimmed = input.trim();
  if (HEX_ID.test(trimmed) || SHORT_LINK.test(trimmed)) {
    return { idOrShortLink: trimmed };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a Trello board URL, short link or board id');
  }
  if (!/(^|\.)trello\.com$/i.test(url.hostname)) {
    throw new Error('URL must be on trello.com');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'b' || !parts[1] || !(SHORT_LINK.test(parts[1]) || HEX_ID.test(parts[1]))) {
    throw new Error('URL must look like https://trello.com/b/<shortLink>/<name>');
  }
  return { idOrShortLink: parts[1] };
}
