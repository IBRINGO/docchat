import { z } from "zod";

/** 24 lowercase/uppercase hex characters — MongoDB's ObjectId string format. Checked explicitly here rather than via the driver's own ObjectId.isValid, which also loosely accepts other 12-byte-ish inputs we don't want to treat as valid at the HTTP boundary. Shared by every request schema that takes a document/conversation id (chat.schema.ts, create-conversation.schema.ts). */
export const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

export const objectIdSchema = z.string().regex(OBJECT_ID_PATTERN, "must be a valid MongoDB ObjectId");
