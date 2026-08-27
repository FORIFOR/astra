/**
 * メールの組み立て。RFC 5322 / RFC 2047 / RFC 4648 §5。
 *
 * 自前で組むのは、依存を増やさないためではなく、**何が外へ出るかを読める形で持つため**。
 * 送信は取り消せない。組み立てが不透明だと、承認カードに載せた内容と
 * 実際に送られる内容がずれても気づけない。
 */

/** base64url。Gmail API は末尾の `=` を嫌う。 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const ASCII_ONLY = /^[\x20-\x7E]*$/;

/**
 * ヘッダ値の符号化。RFC 2047 encoded-word。
 *
 * **日本語の件名をそのまま置くと壊れる。**受信側で文字化けするだけでなく、
 * 送信要求ごと拒否されることがある。ASCII のときは触らない
 * （encoded-word にすると、素朴な受信側で読みにくくなる）。
 */
export function encodeHeaderValue(value: string): string {
  if (ASCII_ONLY.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

/** ヘッダに改行を入れさせない。**ヘッダ注入を止める。** */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export interface DraftMessage {
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly bcc?: readonly string[];
  readonly subject: string;
  readonly body: string;
  readonly from?: string;
  /** 返信のとき。スレッドを繋ぐために要る。 */
  readonly inReplyTo?: string;
  readonly references?: readonly string[];
}

/** RFC 5322 のメッセージを組む。本文は UTF-8 / base64（行折り問題を避ける）。 */
export function buildMime(message: DraftMessage): string {
  const headers: string[] = [];
  const add = (name: string, value: string): void => {
    headers.push(`${name}: ${sanitizeHeader(value)}`);
  };

  if (message.from) add('From', message.from);
  add('To', message.to.map(sanitizeHeader).join(', '));
  if (message.cc?.length) add('Cc', message.cc.map(sanitizeHeader).join(', '));
  if (message.bcc?.length) add('Bcc', message.bcc.map(sanitizeHeader).join(', '));
  add('Subject', encodeHeaderValue(message.subject));
  if (message.inReplyTo) add('In-Reply-To', message.inReplyTo);
  if (message.references?.length) add('References', message.references.join(' '));
  add('MIME-Version', '1.0');
  add('Content-Type', 'text/plain; charset="UTF-8"');
  add('Content-Transfer-Encoding', 'base64');

  const encoded = toBase64Url(new TextEncoder().encode(message.body))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  // 76 文字で折る。RFC 2045 が要求する。
  const wrapped = (encoded.match(/.{1,76}/g) ?? []).join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${wrapped}`;
}

interface Part {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: Part[];
}

/**
 * 本文を取り出す。**text/plain を優先し、無ければ text/html。**
 * 添付（`filename` を持つ部分）は本文として扱わない。
 */
export function extractBody(payload: Part | undefined): { text: string; isHtml: boolean } {
  const plain = findPart(payload, 'text/plain');
  if (plain) return { text: decodePart(plain), isHtml: false };
  const html = findPart(payload, 'text/html');
  if (html) return { text: decodePart(html), isHtml: true };
  return { text: '', isHtml: false };
}

function findPart(part: Part | undefined, mimeType: string): Part | null {
  if (!part) return null;
  if (part.mimeType === mimeType && !part.filename && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return null;
}

function decodePart(part: Part): string {
  if (!part.body?.data) return '';
  try {
    return new TextDecoder().decode(fromBase64Url(part.body.data));
  } catch {
    // 読めない本文を、読めたことにしない
    return '';
  }
}

/** 添付の一覧。**中身は取りに行かない。**名前と大きさだけ。 */
export function listAttachments(
  payload: Part | undefined,
): { filename: string; mimeType: string; sizeBytes: number }[] {
  const out: { filename: string; mimeType: string; sizeBytes: number }[] = [];
  const walk = (part: Part | undefined): void => {
    if (!part) return;
    if (part.filename) {
      out.push({
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        sizeBytes: part.body?.size ?? 0,
      });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return out;
}
