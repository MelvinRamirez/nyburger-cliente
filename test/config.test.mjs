import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_URL } from '../js/config.js';

test('API_URL is not the unfilled deployment placeholder', () => {
  assert.ok(
    !API_URL.includes('<DEPLOYMENT_ID>'),
    'js/config.js still has the <DEPLOYMENT_ID> placeholder instead of the real production /exec URL'
  );
});

test('API_URL points at a script.google.com exec endpoint', () => {
  assert.match(API_URL, /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/);
});
