/** GitHub operation vocabulary shared by the event schema and engine guard. */
export type GithubOperationName =
  | 'issue.read' | 'pull-request.read' | 'repository.read'
  | 'issue.comment.create' | 'issue.comment.update' | 'issue.edit' | 'issue.close' | 'issue.label.add' | 'issue.label.remove' | 'issue.dependency.add' | 'issue.dependency.remove'
  | 'pull-request.comment.create' | 'pull-request.comment.update' | 'pull-request.edit' | 'pull-request.retarget' | 'pull-request.ready' | 'pull-request.draft' | 'pull-request.label.add' | 'pull-request.label.remove'
  | 'intake.issue.comment.create' | 'intake.issue.comment.update' | 'intake.issue.close' | 'intake.issue.label.add' | 'intake.issue.label.remove' | 'intake.issue.dependency.add'
  | 'issue.create' | 'pull-request.create' | 'commit.status.create' | 'stack.read' | 'stack.create' | 'stack.add' | 'label-definition.create' | 'label-definition.update' | 'repository.create' | 'remote-ref.push' | 'remote-ref.delete';

export type GithubOperationRefusalReason = 'other-owner' | 'unresolved-actor' | 'missing-provenance' | 'conflicting-provenance' | 'provenance-unreadable' | 'provenance-timeout' | 'invalid-target' | 'invalid-payload' | 'stack-tip-mismatch' | 'unsupported-operation' | 'explicit-authorization-required';
export type GithubBotAuthRefusalReason = 'token-unavailable' | 'auth-refused' | 'unsupported-remote-transport';
export type GithubOperationTarget =
  | { readonly repository: string; readonly kind: 'repository' }
  | { readonly repository: string; readonly kind: 'issue' | 'pull-request' | 'stack'; readonly number: number }
  | { readonly repository: string; readonly kind: 'label-definition'; readonly name: string }
  | { readonly repository: string; readonly kind: 'remote-ref'; readonly ref: string };
