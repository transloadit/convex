import { action, internalMutation } from "convex/server";
import { v } from "convex/values";
import { buildWeddingSteps } from "../lib/transloadit-steps";
import { components } from "./_generated/api";

const MAX_UPLOADS_PER_HOUR = 6;
const WINDOW_MS = 60 * 60 * 1000;

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
};

const checkUploadLimit = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("uploadLimits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!existing) {
      await ctx.db.insert("uploadLimits", {
        userId: args.userId,
        windowStart: now,
        count: 1,
        lastUploadAt: now,
      });
      return null;
    }
    if (now - existing.windowStart > WINDOW_MS) {
      await ctx.db.patch(existing._id, {
        windowStart: now,
        count: 1,
        lastUploadAt: now,
      });
      return null;
    }
    if (existing.count >= MAX_UPLOADS_PER_HOUR) {
      throw new Error("Upload limit reached. Try again later.");
    }
    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      lastUploadAt: now,
    });
    return null;
  },
});

export const createWeddingAssembly = action({
  args: {
    fileCount: v.number(),
    guestName: v.optional(v.string()),
  },
  returns: v.object({
    assemblyId: v.string(),
    data: v.any(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Authentication required.");
    }

    await ctx.runMutation(checkUploadLimit, { userId: identity.subject });

    const steps = buildWeddingSteps();
    const notifyUrl = requireEnv("TRANSLOADIT_NOTIFY_URL");
    const fileCount = Math.max(1, args.fileCount);

    return ctx.runAction(components.transloadit.lib.createAssembly, {
      steps,
      notifyUrl,
      numExpectedUploadFiles: fileCount,
      fields: {
        guestName: args.guestName ?? "Guest",
        album: "wedding-gallery",
        fileCount,
        userId: identity.subject,
      },
      userId: identity.subject,
      config: {
        authKey: requireEnv("TRANSLOADIT_KEY"),
        authSecret: requireEnv("TRANSLOADIT_SECRET"),
      },
    });
  },
});
