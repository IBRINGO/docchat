import { describe, expect, it } from "vitest";
import { isActiveConversationMode } from "@/lib/utils/conversation-mode";

describe("isActiveConversationMode", () => {
  it("is false when there is no conversationId (document workspace mode)", () => {
    expect(isActiveConversationMode(null)).toBe(false);
  });

  it("is true once a real conversationId is loaded (active conversation mode)", () => {
    expect(isActiveConversationMode("507f1f77bcf86cd799439011")).toBe(true);
  });

  it("is true for a freshly auto-created conversation, which is still titled 'New conversation' — title never factors in, since the function has no access to it at all", () => {
    // A conversation created via ConversationService.createEmptyConversation carries the
    // placeholder title "New conversation" until its first message retitles it. This function's
    // signature (id only) is what guarantees that placeholder title can never be mistaken for
    // "not yet active" — there is no title parameter for a caller to even pass by mistake.
    expect(isActiveConversationMode("6a91bf7a92cf30d4ee783011")).toBe(true);
  });
});
