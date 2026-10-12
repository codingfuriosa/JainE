import './test-setup.js';
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pickPrimaryApplicantAadhaar } from './claude-decision.js';

const candidates = [
  { number: '111122223333', name_on_card: 'Test Customer', relation: 'self' },
  { number: '444455556666', name_on_card: 'Co Applicant', relation: 'spouse' },
];

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = originalFetch; });

function mockMessagesResponse(text) {
  globalThis.fetch = mock.fn(async () => ({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }] }),
  }));
}

test('returns null with zero candidates, without calling the API', async () => {
  globalThis.fetch = mock.fn();
  const result = await pickPrimaryApplicantAadhaar([], 'Test Customer', 'ABCDE1234F');
  assert.equal(result, null);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('returns the single candidate directly, without calling the API', async () => {
  globalThis.fetch = mock.fn();
  const result = await pickPrimaryApplicantAadhaar([candidates[0]], 'Test Customer', 'ABCDE1234F');
  assert.equal(result, '111122223333');
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test('with 2+ candidates, calls the API and uses its verbatim answer', async () => {
  mockMessagesResponse('{"aadhaar_number": "111122223333"}');
  const result = await pickPrimaryApplicantAadhaar(candidates, 'Test Customer', 'ABCDE1234F');
  assert.equal(result, '111122223333');
  assert.equal(globalThis.fetch.mock.callCount(), 1);
});

test('fails closed (returns null) if the API answer is not one of the candidates', async () => {
  mockMessagesResponse('{"aadhaar_number": "999900001111"}');
  const result = await pickPrimaryApplicantAadhaar(candidates, 'Test Customer', 'ABCDE1234F');
  assert.equal(result, null);
});

test('fails closed (returns null) if the API response is not valid JSON', async () => {
  mockMessagesResponse('sure, it is the first one');
  const result = await pickPrimaryApplicantAadhaar(candidates, 'Test Customer', 'ABCDE1234F');
  assert.equal(result, null);
});

test('fails closed (returns null) if the API call itself fails', async () => {
  globalThis.fetch = mock.fn(async () => ({ ok: false, status: 500 }));
  const result = await pickPrimaryApplicantAadhaar(candidates, 'Test Customer', 'ABCDE1234F');
  assert.equal(result, null);
});
