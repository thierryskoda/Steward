import { z } from "zod";

export const codexCliJsonlBaseEventSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

export const codexCliThreadStartedEventSchema = z
  .object({
    type: z.literal("thread.started"),
    thread_id: z.string().min(1),
  })
  .passthrough();

export const codexCliItemCompletedEventSchema = z
  .object({
    type: z.literal("item.completed"),
    item: z
      .object({
        type: z.string(),
        text: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const codexCliErrorEventSchema = z
  .object({
    type: z.literal("error"),
    message: z.string().optional(),
  })
  .passthrough();

export const codexCliTurnFailedEventSchema = z
  .object({
    type: z.literal("turn.failed"),
    message: z.string().optional(),
    error: z
      .object({
        message: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
