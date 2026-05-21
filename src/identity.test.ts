import { describe, expect, it } from 'vitest';
import { autoIdentity, explicitIdentity, templateUrl, viewportBucket } from './identity.js';

describe('templateUrl', () => {
  it('templates numeric ids', () => {
    expect(templateUrl('https://app.test/users/123')).toBe('/users/:id');
  });
  it('templates UUIDs', () => {
    expect(templateUrl('https://app.test/orders/550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/orders/:id',
    );
  });
  it('templates Mongo ObjectIds', () => {
    expect(templateUrl('https://app.test/posts/507f1f77bcf86cd799439011')).toBe('/posts/:id');
  });
  it('templates long hex strings', () => {
    expect(templateUrl('https://app.test/files/abc123def456abc123def456')).toBe('/files/:id');
  });
  it('keeps human-readable slugs', () => {
    expect(templateUrl('https://app.test/posts/hello-world')).toBe('/posts/hello-world');
  });
  it('strips query/hash by default', () => {
    expect(templateUrl('https://app.test/users/123?foo=bar#section')).toBe('/users/:id');
  });
  it('keeps query when configured', () => {
    expect(templateUrl('https://app.test/search?q=x', { includeQueryParams: true })).toBe(
      '/search?q=x',
    );
  });
  it('handles root', () => {
    expect(templateUrl('https://app.test/')).toBe('/');
  });
});

describe('viewportBucket', () => {
  it('classifies mobile', () => expect(viewportBucket(400)).toBe('mobile'));
  it('classifies tablet', () => expect(viewportBucket(800)).toBe('tablet'));
  it('classifies desktop', () => expect(viewportBucket(1280)).toBe('desktop'));
});

describe('autoIdentity / explicitIdentity', () => {
  it('autoIdentity is stable across URLs with the same template + viewport', () => {
    const a = autoIdentity('https://app.test/users/1', { width: 1280, height: 720 });
    const b = autoIdentity('https://app.test/users/999', { width: 1280, height: 720 });
    expect(a.id).toBe(b.id);
    expect(a.urlTemplate).toBe('/users/:id');
  });
  it('autoIdentity differs across viewports', () => {
    const desktop = autoIdentity('https://app.test/users/1', { width: 1280, height: 720 });
    const mobile = autoIdentity('https://app.test/users/1', { width: 400, height: 800 });
    expect(desktop.id).not.toBe(mobile.id);
  });
  it('explicit name wins', () => {
    const e = explicitIdentity('LoginPage', 'https://app.test/auth/login', {
      width: 1280,
      height: 720,
    });
    expect(e.name).toBe('LoginPage');
    expect(e.explicit).toBe(true);
  });
});
