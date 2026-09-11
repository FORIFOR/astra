import test from 'node:test';
import assert from 'node:assert/strict';
import { localURL, desktopEmail } from '../start-local-host.mjs';
test('preview credentials cannot be sent to a remote or credential-bearing URL', () => {
  for (const input of [
    'https://example.com',
    'http://localhost.example.com',
    'http://user:pass@localhost:3000',
    'http://localhost:3000?target=x',
    'file:///tmp/service',
  ])
    assert.throws(() => localURL(input));
  assert.equal(localURL('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  assert.equal(localURL('http://[::1]:3000'), 'http://[::1]:3000');
});
test('desktop identity maps to the same isolated development account', () => {
  assert.equal(desktopEmail('123abc-456def'), 'main-123abc-456def@astra.local');
  for (const identity of ['', '../other', 'person@example.com', 'x\nadmin'])
    assert.throws(() => desktopEmail(identity));
});
