import type { TokenContext } from './download.ts';
import { fetchPullRequest } from './github.ts';
import type { GraphQLClient } from './github.ts';
import type { Comment, PullRequestData } from './model.ts';
import type { PullRequestRef } from './pr-url.ts';

export const VIEWER_QUERY = 'query { viewer { login } }';

export const ADD_COMMENT = `
mutation($input: AddCommentInput!) {
  addComment(input: $input) { commentEdge { node { id url } } }
}`;

export const DELETE_REVIEW = `
mutation($input: DeletePullRequestReviewInput!) {
  deletePullRequestReview(input: $input) { pullRequestReview { id } }
}`;

export const ID_NOT_READ = 'created, but its id could not be read from the URL';

export interface WrittenComment {
  id: string;
  url: string;
}

export type PullRequestLoader = (client: GraphQLClient, ref: PullRequestRef) => Promise<PullRequestData>;

export interface ViewerAndPullRequest {
  viewer: string;
  data: PullRequestData;
  pendingReviewId: string | undefined;
}

export const sameLogin = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const normalize = (body: string): string => body.replaceAll('\r\n', '\n').trim();

export const sameText = (a: string, b: string): boolean => normalize(a) === normalize(b);

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const isPending = (run: { data: PullRequestData }, comment: Comment): boolean =>
  run.data.reviews.find((r) => r.id === comment.reviewId)?.state === 'PENDING';

// Reads the authenticated viewer login and the pull request data, and finds any pending review owned by the viewer.
export async function readViewerAndPullRequest(
  context: TokenContext,
  ref: PullRequestRef,
  loader: PullRequestLoader = fetchPullRequest,
): Promise<ViewerAndPullRequest> {
  const { viewer } = await context.client<{ viewer: { login: string } }>(VIEWER_QUERY, {});
  const data = await loader(context.client, ref);
  const pending = data.reviews.find((r) => r.state === 'PENDING' && sameLogin(r.author, viewer.login));
  return { viewer: viewer.login, data, pendingReviewId: pending?.id };
}

// Posts an immediate conversation comment on the pull request via GraphQL addComment.
export async function addConversationComment(
  context: TokenContext,
  pullRequestId: string,
  body: string,
): Promise<WrittenComment> {
  const data = await context.client<{ addComment: { commentEdge: { node: WrittenComment } } }>(ADD_COMMENT, {
    input: { subjectId: pullRequestId, body },
  });
  return data.addComment.commentEdge.node;
}

// Deletes an empty pending review that was created for a single comment or reply when that write fails.
export async function discardEmptyReview(context: TokenContext, reviewId: string, reason: string): Promise<string> {
  try {
    await context.client(DELETE_REVIEW, { input: { pullRequestReviewId: reviewId } });
    return reason;
  } catch (error) {
    return `${reason}; the empty pending review could not be deleted either: ${messageOf(error)}`;
  }
}
