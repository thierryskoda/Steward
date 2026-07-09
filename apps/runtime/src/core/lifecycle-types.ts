import { z } from "zod";
import { ActivityEventSchema, type IActivityEvent } from "@steward/contracts/schemas";

export type { IActivityEvent };

/**
 * Lifecycle = append-only activity trail. Path = coarse status; activities = runtime truth.
 */
export type ILifecycleTimestamps = {
  activities?: IActivityEvent[];
};

export const LifecycleTimestampsZodSchema = z.object({
  activities: z.array(ActivityEventSchema).optional(),
});
