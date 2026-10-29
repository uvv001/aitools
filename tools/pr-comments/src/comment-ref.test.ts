import { describe, expect, it } from 'vitest';
import { commentLink, commentRefFromUrl, isCommentRef } from './comment-ref.ts';

describe('comment ref', () => {
  it('takes the ref of a review comment or a conversation comment from its URL', () => {
    expect(commentRefFromUrl('https://ghe.example.com/ACME/Example.Foundation/pull/42#discussion_r12345')).toBe('r12345');
    expect(commentRefFromUrl('https://ghe.example.com/ACME/Example.Foundation/pull/43#issuecomment-67890')).toBe('c67890');
  });

  it('gives nothing for other URLs', () => {
    expect(commentRefFromUrl('https://ghe.example.com/o/r/pull/1#pullrequestreview-5')).toBeUndefined();
    expect(commentRefFromUrl('https://ghe.example.com/o/r/pull/1#discussion_rc-1')).toBeUndefined();
    expect(commentRefFromUrl('https://ghe.example.com/o/r/pull/1')).toBeUndefined();
    expect(commentRefFromUrl('https://ghe.example.com/o/r/pull/1#issuecomment-')).toBeUndefined();
  });

  it('accepts only r or c followed by digits', () => {
    expect(isCommentRef('r544830')).toBe(true);
    expect(isCommentRef('c1')).toBe(true);
    for (const bad of ['', 'r', 'R544830', 'x12', 'r12a', '544830', 'rr1', ' r1']) expect(isCommentRef(bad)).toBe(false);
  });
});

describe('comment link', () => {
  const PR = 'https://ghe.example.com/acme/widgets/pull/157';

  it('links a review comment to its discussion on the pull request', () => {
    expect(commentLink(PR, 'r544830')).toBe('[r544830](https://ghe.example.com/acme/widgets/pull/157#discussion_r544830)');
  });

  it('links a conversation comment to its issue comment on the pull request', () => {
    expect(commentLink(PR, 'c623843')).toBe('[c623843](https://ghe.example.com/acme/widgets/pull/157#issuecomment-623843)');
  });

  it('replaces the fragment a pull request URL already has', () => {
    expect(commentLink(`${PR}#discussion_r1`, 'r544830')).toBe('[r544830](https://ghe.example.com/acme/widgets/pull/157#discussion_r544830)');
    expect(commentLink(`${PR}#issuecomment-5`, 'c623843')).toBe('[c623843](https://ghe.example.com/acme/widgets/pull/157#issuecomment-623843)');
  });

  it('leaves a check annotation as the bare ref: it has no URL', () => {
    expect(commentLink(PR, 'a3f9c2d1e')).toBe('a3f9c2d1e');
  });

  it('leaves the ref bare when the review is not connected to a pull request', () => {
    expect(commentLink(undefined, 'r544830')).toBe('r544830');
    expect(commentLink(undefined, 'c623843')).toBe('c623843');
    expect(commentLink(undefined, 'a3f9c2d1e')).toBe('a3f9c2d1e');
  });

  it('leaves what is no ref as it is', () => {
    expect(commentLink(PR, 'x12')).toBe('x12');
    expect(commentLink(PR, '')).toBe('');
  });
});
