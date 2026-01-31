import { signParams, verifyWebhookSignature } from '@transloadit/utils';
import type { AssemblyStatusResults } from '@transloadit/zod/v3/assemblyStatus';
import { transloaditError } from '../shared/errors.ts';
import type {
  BuildParamsOptions,
  BuildParamsResult,
  ParsedWebhookRequest,
  VerifiedWebhookRequest,
  WebhookActionArgs,
} from '../shared/schemas.ts';

export function buildTransloaditParams(options: BuildParamsOptions): BuildParamsResult {
  if (!options.templateId && !options.steps) {
    throw transloaditError(
      'createAssembly',
      'Provide either templateId or steps to create an Assembly',
    );
  }

  const auth: Record<string, string> = {
    key: options.authKey,
  };

  auth.expires = options.expires ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const params: Record<string, unknown> = {
    auth,
  };

  if (options.templateId) params.template_id = options.templateId;
  if (options.steps) params.steps = options.steps;
  if (options.fields) params.fields = options.fields;
  if (options.notifyUrl) params.notify_url = options.notifyUrl;
  if (options.numExpectedUploadFiles !== undefined) {
    params.num_expected_upload_files = options.numExpectedUploadFiles;
  }

  if (options.additionalParams) {
    for (const [key, value] of Object.entries(options.additionalParams)) {
      if (value !== undefined) {
        params[key] = value;
      }
    }
  }

  return {
    params,
    paramsString: JSON.stringify(params),
  };
}

export async function signTransloaditParams(
  paramsString: string,
  authSecret: string,
): Promise<string> {
  return signParams(paramsString, authSecret, 'sha384');
}

export async function parseTransloaditWebhook(request: Request): Promise<ParsedWebhookRequest> {
  const formData = await request.formData();
  const rawPayload = formData.get('transloadit');
  const signature = formData.get('signature');

  if (typeof rawPayload !== 'string') {
    throw transloaditError('webhook', 'Missing transloadit payload');
  }

  return {
    payload: JSON.parse(rawPayload),
    rawBody: rawPayload,
    signature: typeof signature === 'string' ? signature : undefined,
  };
}

export async function parseAndVerifyTransloaditWebhook(
  request: Request,
  options: {
    authSecret: string;
    requireSignature?: boolean;
  },
): Promise<VerifiedWebhookRequest> {
  const parsed = await parseTransloaditWebhook(request);
  const authSecret = options.authSecret;
  if (!authSecret) {
    throw transloaditError('webhook', 'Missing authSecret for webhook verification');
  }
  const verified = await verifyWebhookSignature({
    rawBody: parsed.rawBody,
    signatureHeader: parsed.signature,
    authSecret,
  });

  if (options.requireSignature ?? true) {
    if (!verified) {
      throw transloaditError('webhook', 'Invalid Transloadit webhook signature');
    }
  }

  return { ...parsed, verified };
}

export async function buildWebhookQueueArgs(
  request: Request,
  options: {
    authSecret: string;
    requireSignature?: boolean;
  },
): Promise<ParsedWebhookRequest> {
  if (options.requireSignature === false) {
    return parseTransloaditWebhook(request);
  }

  const parsed = await parseAndVerifyTransloaditWebhook(request, options);
  return {
    payload: parsed.payload,
    rawBody: parsed.rawBody,
    signature: parsed.signature,
  };
}

export async function handleWebhookRequest(
  request: Request,
  options: {
    mode?: 'queue' | 'sync';
    runAction: (args: WebhookActionArgs) => Promise<unknown>;
    requireSignature?: boolean;
    authSecret?: string;
    responseStatus?: number;
  },
): Promise<Response> {
  const mode = options.mode ?? 'queue';
  const requireSignature = options.requireSignature ?? false;

  const parsed = requireSignature
    ? await parseAndVerifyTransloaditWebhook(request, {
        authSecret: options.authSecret ?? '',
        requireSignature: true,
      })
    : await parseTransloaditWebhook(request);

  await options.runAction({
    payload: parsed.payload,
    rawBody: parsed.rawBody,
    signature: parsed.signature,
  });

  const status = options.responseStatus ?? (mode === 'sync' ? 204 : 202);
  return new Response(null, { status });
}

export { verifyWebhookSignature };

export type AssemblyResult = AssemblyStatusResults[string][number];

export type AssemblyResultRecord = {
  stepName: string;
  result: AssemblyResult;
};

export function flattenResults(results: AssemblyStatusResults | undefined): AssemblyResultRecord[] {
  if (!results) return [];
  const output: AssemblyResultRecord[] = [];
  for (const [stepName, entries] of Object.entries(results)) {
    if (!Array.isArray(entries)) continue;
    for (const result of entries) {
      output.push({ stepName, result });
    }
  }
  return output;
}
