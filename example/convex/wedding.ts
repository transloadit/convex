import { vAssemblyOptions } from '@transloadit/convex';
import { v } from 'convex/values';
import { buildWeddingSteps } from '../lib/transloadit-steps';
import { components, internal } from './_generated/api';
import { action, internalMutation } from './_generated/server';

const MAX_UPLOADS_PER_HOUR = 6;
const WINDOW_MS = 60 * 60 * 1000;

const requireEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
};

export const checkUploadLimit = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('uploadLimits')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .first();
    if (!existing) {
      await ctx.db.insert('uploadLimits', {
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
      throw new Error('Upload limit reached. Try again later.');
    }
    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      lastUploadAt: now,
    });
    return null;
  },
});

export const createWeddingAssemblyOptions = action({
  args: {
    fileCount: v.number(),
    guestName: v.optional(v.string()),
    uploadCode: v.optional(v.string()),
  },
  returns: v.object({
    assemblyOptions: vAssemblyOptions,
    params: v.any(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error('Authentication required.');
    }

    await ctx.runMutation(internal.wedding.checkUploadLimit, {
      userId: identity.subject,
    });

    const requiredCode = process.env.WEDDING_UPLOAD_CODE;
    if (requiredCode) {
      const provided = args.uploadCode?.trim();
      if (!provided || provided !== requiredCode) {
        throw new Error('Upload code required.');
      }
    }

    const steps = buildWeddingSteps();
    const notifyUrl = requireEnv('TRANSLOADIT_NOTIFY_URL');
    const fileCount = Math.max(1, args.fileCount);
    const assemblyArgs = {
      steps,
      notifyUrl,
      numExpectedUploadFiles: fileCount,
      fields: {
        guestName: args.guestName ?? 'Guest',
        album: 'wedding-gallery',
        fileCount,
        userId: identity.subject,
      },
      userId: identity.subject,
    };

    const assemblyOptions = await ctx.runAction(components.transloadit.lib.createAssemblyOptions, {
      ...assemblyArgs,
      config: {
        authKey: requireEnv('TRANSLOADIT_KEY'),
        authSecret: requireEnv('TRANSLOADIT_SECRET'),
      },
    });

    const parsedParams = safeParseParams(assemblyOptions.params);
    const params = redactSecrets(parsedParams ?? assemblyArgs);

    return {
      assemblyOptions,
      params,
    };
  },
});

const safeParseParams = (value: string) => {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (error) {
    console.warn('Failed to parse Transloadit params', error);
    return null;
  }
};

const secretKeys = new Set(['secret', 'key', 'credentials', 'authSecret', 'authKey']);

const redactSecrets = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      if (secretKeys.has(key)) {
        return [key, '***'];
      }
      return [key, redactSecrets(val)];
    });
    return Object.fromEntries(entries);
  }
  return value;
};
