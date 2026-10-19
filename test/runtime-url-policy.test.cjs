const assert = require('node:assert/strict');
const test = require('node:test');
const { isAllowedExternalUrl, isTrustedAppUrl, isTrustedFrameUrl } = require('../desktop/url-policy.cjs');

test('allows only valid HTTPS and mailto links for external opening', () => {
  assert.equal(isAllowedExternalUrl('https://example.com/path'), true);
  assert.equal(isAllowedExternalUrl('mailto:reader@example.com'), true);
  assert.equal(isAllowedExternalUrl('http://example.com'), false);
  assert.equal(isAllowedExternalUrl('file:///etc/passwd'), false);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedExternalUrl('https://user:pass@example.com'), false);
  assert.equal(isAllowedExternalUrl('mailto:'), false);
  assert.equal(isAllowedExternalUrl('not a url'), false);
});

test('trusts only the exact local server origin', () => {
  assert.equal(isTrustedAppUrl('http://127.0.0.1:43127/book', 'http://127.0.0.1:43127'), true);
  assert.equal(isTrustedAppUrl('http://127.0.0.1:43128/book', 'http://127.0.0.1:43127'), false);
  assert.equal(isTrustedAppUrl('https://127.0.0.1:43127/book', 'http://127.0.0.1:43127'), false);
  assert.equal(isTrustedAppUrl('http://user@127.0.0.1:43127/book', 'http://127.0.0.1:43127'), false);
  assert.equal(isTrustedFrameUrl('blob:http://127.0.0.1:43127/abc', 'http://127.0.0.1:43127'), true);
  assert.equal(isTrustedAppUrl('blob:http://127.0.0.1:43127/abc', 'http://127.0.0.1:43127'), false);
  assert.equal(isTrustedFrameUrl('https://evil.example/', 'http://127.0.0.1:43127'), false);
  assert.equal(isTrustedAppUrl('data:text/html,hi', 'http://127.0.0.1:43127'), false);
});
