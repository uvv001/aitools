import { describe, expect, it } from 'vitest';
import {
  commentLink,
  commentRefFromUrl,
  commentUrl,
  digestBody,
  isCommentRef,
  isLinkRef,
  isReviewBodyRef,
  linkableReviewRef,
  normalizeBody,
  reviewRefFromUrl,
} from './comment-ref.ts';

describe('comment ref', () => {
  it('takes the ref of a review comment or a conversation comment from its URL', () => {
    expect(commentRefFromUrl('https://ghe.example.com/ACME/Example.Foundation/pull/42#discussion_r12345')).toBe('r12345');
    expect(commentRefFromUrl('https://ghe.example.com/ACME/Example.Foundation/pull/43#issuecomment-67890')).toBe('c67890');
  });

  it('gives nothing for other URLs, including pull request reviews', () => {
    expect(commentRefFromUrl('https://ghe.example.com/o/r/pull/1#pullrequestreview-5')).toBeUndefined();
    expect(commentRefFromUrl('https://ghe.example.com/o/r/pull/1#discussion_rc-1')).toBeUndefined();
    expect(commentRefFromUrl('https://ghe.example.com/o/r/pull/1')).toBeUndefined();
    expect(commentRefFromUrl('https://ghe.example.com/o/r/pull/1#issuecomment-')).toBeUndefined();
  });

  it('accepts only r or c followed by digits', () => {
    expect(isCommentRef('r544830')).toBe(true);
    expect(isCommentRef('c1')).toBe(true);
    expect(isCommentRef('r0')).toBe(true);
    for (const bad of ['', 'r', 'R544830', 'v91204', 'v0', 'x12', 'r12a', '544830', 'rr1', ' r1', 'a3f9c2d1e']) {
      expect(isCommentRef(bad)).toBe(false);
    }
  });
});

describe('review body ref', () => {
  it('takes the ref of a pull request review from its URL', () => {
    expect(reviewRefFromUrl('https://ghe.example.com/ACME/Example.Foundation/pull/42#pullrequestreview-91204')).toBe('v91204');
    expect(reviewRefFromUrl('https://github.com/o/r/pull/1#pullrequestreview-0')).toBe('v0');
  });

  it('gives nothing for comment or malformed URLs', () => {
    expect(reviewRefFromUrl('https://ghe.example.com/o/r/pull/1#discussion_r5')).toBeUndefined();
    expect(reviewRefFromUrl('https://ghe.example.com/o/r/pull/1#issuecomment-5')).toBeUndefined();
    expect(reviewRefFromUrl('https://ghe.example.com/o/r/pull/1#pullrequestreview-')).toBeUndefined();
    expect(reviewRefFromUrl('https://ghe.example.com/o/r/pull/1#pullrequestreview-5a')).toBeUndefined();
    expect(reviewRefFromUrl('https://ghe.example.com/o/r/pull/1')).toBeUndefined();
  });

  it('accepts only v followed by digits', () => {
    expect(isReviewBodyRef('v91204')).toBe(true);
    expect(isReviewBodyRef('v0')).toBe(true);
    for (const bad of ['', 'v', 'V91204', 'r544830', 'c623843', 'v12a', 'vv1', ' v1', 'v-1', 'a3f9c2d1e']) {
      expect(isReviewBodyRef(bad)).toBe(false);
    }
  });

  it('includes comments, review bodies and check annotations in isLinkRef', () => {
    for (const good of ['r544830', 'c623843', 'v91204', 'v0', 'a3f9c2d1e']) expect(isLinkRef(good)).toBe(true);
    for (const bad of ['', 'x12', 'R1', 'V1', 'A3f9c2d1e', 'v', 'a123']) expect(isLinkRef(bad)).toBe(false);
  });

  it('returns linkableReviewRef only for non-pending reviews with non-empty text', () => {
    const url = 'https://ghe.example.com/o/r/pull/1#pullrequestreview-5';
    expect(linkableReviewRef({ state: 'CHANGES_REQUESTED', body: 'Fix retry cap.', url })).toBe('v5');
    expect(linkableReviewRef({ state: 'COMMENTED', body: '  Note  ', url })).toBe('v5');
    expect(linkableReviewRef({ state: 'PENDING', body: 'Draft summary', url })).toBeUndefined();
    expect(linkableReviewRef({ state: 'APPROVED', body: '', url })).toBeUndefined();
    expect(linkableReviewRef({ state: 'APPROVED', body: ' \n\t ', url })).toBeUndefined();
    expect(linkableReviewRef({ state: 'CHANGES_REQUESTED', body: 'Fix', url: 'https://ghe.example.com/o/r/pull/1' })).toBeUndefined();
  });
});

describe('comment link', () => {
  const PR = 'https://ghe.example.com/acme/widgets/pull/157';

  it('links a review comment, conversation comment or pull request review to its anchor on the pull request', () => {
    expect(commentUrl(PR, 'r544830')).toBe('https://ghe.example.com/acme/widgets/pull/157#discussion_r544830');
    expect(commentUrl(PR, 'c623843')).toBe('https://ghe.example.com/acme/widgets/pull/157#issuecomment-623843');
    expect(commentUrl(PR, 'v91204')).toBe('https://ghe.example.com/acme/widgets/pull/157#pullrequestreview-91204');
    expect(commentLink(PR, 'r544830')).toBe('[r544830](https://ghe.example.com/acme/widgets/pull/157#discussion_r544830)');
    expect(commentLink(PR, 'c623843')).toBe('[c623843](https://ghe.example.com/acme/widgets/pull/157#issuecomment-623843)');
    expect(commentLink(PR, 'v91204')).toBe('[v91204](https://ghe.example.com/acme/widgets/pull/157#pullrequestreview-91204)');
  });

  it('replaces the fragment a pull request URL already has', () => {
    expect(commentLink(`${PR}#discussion_r1`, 'r544830')).toBe('[r544830](https://ghe.example.com/acme/widgets/pull/157#discussion_r544830)');
    expect(commentLink(`${PR}#issuecomment-5`, 'c623843')).toBe('[c623843](https://ghe.example.com/acme/widgets/pull/157#issuecomment-623843)');
    expect(commentLink(`${PR}#pullrequestreview-1`, 'v91204')).toBe('[v91204](https://ghe.example.com/acme/widgets/pull/157#pullrequestreview-91204)');
  });

  it('refuses non-URL refs in commentUrl and leaves a check annotation bare in commentLink', () => {
    expect(() => commentUrl(PR, 'a3f9c2d1e')).toThrow('"a3f9c2d1e" is not a comment or pull request review id; expected r544830, c623843 or v91204');
    expect(commentLink(PR, 'a3f9c2d1e')).toBe('a3f9c2d1e');
  });

  it('leaves the ref bare when the review is not connected to a pull request', () => {
    expect(commentLink(undefined, 'r544830')).toBe('r544830');
    expect(commentLink(undefined, 'c623843')).toBe('c623843');
    expect(commentLink(undefined, 'v91204')).toBe('v91204');
    expect(commentLink(undefined, 'a3f9c2d1e')).toBe('a3f9c2d1e');
  });

  it('leaves what is no ref as it is', () => {
    expect(commentLink(PR, 'x12')).toBe('x12');
    expect(commentLink(PR, '')).toBe('');
  });
});

describe('digestBody', () => {
  it('normalizes CRLF, leading blank lines and trailing whitespace while preserving leading indentation on line 1', () => {
    expect(normalizeBody('  \r\n\t\nPlease cap retries.\r\nSecond line.\r\nThird line. \r\n\t')).toBe(
      'Please cap retries.\nSecond line.\nThird line.',
    );
    expect(normalizeBody('\n  \n    **Issue**\n  ')).toBe('    **Issue**');
    expect(normalizeBody('   \r\n ')).toBe('');
  });

  it('computes a 64-hex SHA-256 digest after normalizing CRLF, leading blank lines and trailing whitespace while preserving leading indentation', () => {
    const base = digestBody('Please cap retries.\nSecond line.');
    expect(base).toMatch(/^[0-9a-f]{64}$/u);
    expect(digestBody('  \r\n\t\nPlease cap retries.\r\nSecond line. \r\n\t')).toBe(base);
    expect(digestBody('Please cap retries.\nDifferent line.')).not.toBe(base);
    expect(digestBody('    text')).not.toBe(digestBody('text'));
    expect(digestBody('   \r\n ')).toBe(digestBody(''));
  });
});
