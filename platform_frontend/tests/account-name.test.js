// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toAccountDomain,
  toBareAccount,
  toClaimsLogin,
  CLAIMS_PREFIX,
  AD_DOMAIN,
} from '../src/services/account-name.js';

test('toBareAccount: strips the claims prefix and AD domain to a bare account', () => {
  assert.equal(toBareAccount('i:0#.w|CONTOSO\\jsmith'), 'jsmith');
});

test('toBareAccount: strips a bare DOMAIN\\account with no claims prefix', () => {
  assert.equal(toBareAccount('CONTOSO\\jsmith'), 'jsmith');
});

test('toBareAccount: leaves an already-bare account unchanged', () => {
  assert.equal(toBareAccount('jsmith'), 'jsmith');
});

test('toBareAccount: trims surrounding whitespace', () => {
  assert.equal(toBareAccount('  CONTOSO\\jsmith  '), 'jsmith');
});

test('toBareAccount: takes the segment after the last backslash for nested domains', () => {
  assert.equal(toBareAccount('i:0#.w|EU\\CONTOSO\\jsmith'), 'jsmith');
});

test('toBareAccount: coerces null/undefined to empty string', () => {
  assert.equal(toBareAccount(/** @type {any} */ (null)), '');
  assert.equal(toBareAccount(/** @type {any} */ (undefined)), '');
});

test('CLAIMS_PREFIX is the single-farm claims encoding', () => {
  assert.equal(CLAIMS_PREFIX, 'i:0#.w|');
});

test('toClaimsLogin: reattaches the claims prefix and AD domain to a bare account', () => {
  assert.equal(toClaimsLogin('jsmith'), `i:0#.w|${AD_DOMAIN}\\jsmith`);
});

test('toClaimsLogin: round-trips with toBareAccount', () => {
  assert.equal(toBareAccount(toClaimsLogin('jsmith')), 'jsmith');
});

test('toClaimsLogin: attaches a known domain instead of the default one', () => {
  assert.equal(toClaimsLogin('2002', 'OTHERDOM'), 'i:0#.w|OTHERDOM\\2002');
  assert.equal(toClaimsLogin('2002', ''), `i:0#.w|${AD_DOMAIN}\\2002`);
});

test('toAccountDomain: takes the domain a login names, without the claims prefix', () => {
  assert.equal(toAccountDomain('i:0#.w|OTHERDOM\\2002'), 'OTHERDOM');
  assert.equal(toAccountDomain('  OTHERDOM\\2002 '), 'OTHERDOM');
  assert.equal(toAccountDomain('i:0#.w|EU\\CONTOSO\\jsmith'), 'EU\\CONTOSO');
});

test('toAccountDomain: a login naming no domain answers the empty string', () => {
  assert.equal(toAccountDomain('jsmith'), '');
  assert.equal(toAccountDomain(/** @type {any} */ (null)), '');
});

test('toAccountDomain and toBareAccount round-trip through toClaimsLogin', () => {
  const login = 'i:0#.w|OTHERDOM\\2002';
  assert.equal(
    toClaimsLogin(toBareAccount(login), toAccountDomain(login)),
    login
  );
});
