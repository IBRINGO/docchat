/**
 * Derives which of the app's two UI modes (app/page.tsx) should be shown,
 * from existing conversation state alone — never a separate piece of state
 * to keep in sync, and never derived from a conversation's title. A freshly
 * auto-created conversation (see ConversationService.createEmptyConversation)
 * is titled "New conversation" and must still count as fully active; this
 * function's signature — it only ever receives a conversationId, nothing
 * about title — is itself the guarantee that title can never leak into the
 * decision.
 *
 * true ("active conversation" mode): a real, persisted conversationId is
 * currently loaded — the interface focuses on that one conversation and
 * hides the upload/document-selection workspace.
 *
 * false ("document workspace" mode): no conversation is loaded — either
 * nothing has been started yet, or "New Conversation" just cleared it.
 */
export function isActiveConversationMode(conversationId: string | null): boolean {
  return conversationId !== null;
}
