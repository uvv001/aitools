import { describe, expect, it } from 'vitest';
import { parsePullRequestUrl } from './pr-url.ts';

describe('parsePullRequestUrl', () => {
  it('parses an enterprise pull request URL', () => {
    expect(parsePullRequestUrl('https://ghe.example.com/ACME/Example.Foundation/pull/42')).toEqual({
      host: 'ghe.example.com',
      owner: 'ACME',
      repo: 'Example.Foundation',
      number: 42,
    });
  });

  it('keeps a non-default port as part of the host', () => {
    expect(parsePullRequestUrl('https://ghe.example.com:8443/a/b/pull/7').host).toBe('ghe.example.com:8443');
  });

  it('ignores a trailing slash', () => {
    expect(parsePullRequestUrl('https://github.com/a/b/pull/7/').number).toBe(7);
  });

  it('rejects sub-pages of a pull request', () => {
    expect(() => parsePullRequestUrl('https://github.com/a/b/pull/7/files')).toThrow(/pull request URL/);
  });

  it('rejects non-pull-request URLs', () => {
    expect(() => parsePullRequestUrl('https://github.com/a/b/issues/7')).toThrow(/pull request URL/);
  });

  it('rejects text that is not a URL', () => {
    expect(() => parsePullRequestUrl('ACME/Example.Foundation#42')).toThrow(/valid URL/);
  });
});
