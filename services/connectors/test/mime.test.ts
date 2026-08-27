import { describe, expect, it } from 'vitest';
import {
  buildMime,
  encodeHeaderValue,
  extractBody,
  fromBase64Url,
  listAttachments,
  toBase64Url,
} from '../src/mime.js';

const encode = (s: string): string => toBase64Url(new TextEncoder().encode(s));

describe('mime', () => {
  it('round-trips base64url without padding', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0x00, 0x41]);
    const encoded = toBase64Url(bytes);
    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect([...fromBase64Url(encoded)]).toEqual([...bytes]);
  });

  it('leaves an ASCII subject alone and encodes a Japanese one', () => {
    expect(encodeHeaderValue('Weekly report')).toBe('Weekly report');
    const encoded = encodeHeaderValue('週次報告');
    expect(encoded.startsWith('=?UTF-8?B?')).toBe(true);
    expect(encoded.endsWith('?=')).toBe(true);
  });

  it('keeps a Japanese body readable after the round trip', () => {
    const mime = buildMime({ to: ['a@example.com'], subject: 'x', body: '本文です。\n2行目' });
    const base64 = mime.split('\r\n\r\n')[1]!.replace(/\r\n/g, '');
    expect(new TextDecoder().decode(fromBase64Url(base64))).toBe('本文です。\n2行目');
  });

  it('refuses to let a newline in a header start a new header', () => {
    const mime = buildMime({
      to: ['a@example.com\r\nBcc: attacker@example.com'],
      subject: 'x',
      body: 'y',
    });
    const headers = mime.split('\r\n\r\n')[0]!;
    expect(headers).not.toMatch(/^Bcc:/m);
    expect(headers).toContain('a@example.com Bcc: attacker@example.com');
  });

  it('wraps the encoded body at 76 characters', () => {
    const mime = buildMime({ to: ['a@example.com'], subject: 's', body: 'x'.repeat(500) });
    for (const line of mime.split('\r\n\r\n')[1]!.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });

  it('prefers text/plain over text/html', () => {
    const body = extractBody({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: encode('<b>hi</b>') } },
        { mimeType: 'text/plain', body: { data: encode('hi') } },
      ],
    });
    expect(body).toEqual({ text: 'hi', isHtml: false });
  });

  it('falls back to html and says so', () => {
    const body = extractBody({
      mimeType: 'multipart/alternative',
      parts: [{ mimeType: 'text/html', body: { data: encode('<b>hi</b>') } }],
    });
    expect(body).toEqual({ text: '<b>hi</b>', isHtml: true });
  });

  it('does not read an attachment as the body', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', filename: 'notes.txt', body: { data: encode('attached') } },
        { mimeType: 'text/plain', body: { data: encode('real body') } },
      ],
    };
    expect(extractBody(payload).text).toBe('real body');
  });

  it('finds a body nested two levels deep', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [{ mimeType: 'text/plain', body: { data: encode('deep') } }],
        },
      ],
    };
    expect(extractBody(payload).text).toBe('deep');
  });

  it('returns an empty body rather than inventing one when nothing decodes', () => {
    expect(extractBody(undefined)).toEqual({ text: '', isHtml: false });
    expect(extractBody({ mimeType: 'text/plain', body: { data: '!!!not base64!!!' } }).text).toBe(
      '',
    );
  });

  it('lists attachments by name and size without fetching them', () => {
    const found = listAttachments({
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: encode('body') } },
        { mimeType: 'application/pdf', filename: 'a.pdf', body: { size: 1234 } },
      ],
    });
    expect(found).toEqual([{ filename: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 1234 }]);
  });
});
