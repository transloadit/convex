/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

export type ComponentApi<Name extends string | undefined = string | undefined> = {
  lib: {
    upsertAssembly: FunctionReference<
      "mutation",
      "internal",
      {
        assemblyId: string;
        status?: string;
        ok?: string;
        message?: string;
        templateId?: string;
        notifyUrl?: string;
        numExpectedUploadFiles?: number;
        fields?: any;
        uploads?: any;
        results?: any;
        error?: any;
        raw?: any;
        userId?: string;
      },
      string,
      Name
    >;
    replaceResultsForAssembly: FunctionReference<
      "mutation",
      "internal",
      {
        assemblyId: string;
        results: Array<{ stepName: string; result: any }>;
      },
      null,
      Name
    >;
    createAssembly: FunctionReference<
      "action",
      "internal",
      {
        config: { authKey: string; authSecret: string };
        templateId?: string;
        steps?: any;
        fields?: any;
        notifyUrl?: string;
        numExpectedUploadFiles?: number;
        expires?: string;
        additionalParams?: any;
        userId?: string;
      },
      { assemblyId: string; data: any },
      Name
    >;
    generateUploadParams: FunctionReference<
      "action",
      "internal",
      {
        config: { authKey: string; authSecret: string };
        templateId?: string;
        steps?: any;
        fields?: any;
        notifyUrl?: string;
        numExpectedUploadFiles?: number;
        expires?: string;
        additionalParams?: any;
        userId?: string;
      },
      { params: string; signature: string; url: string },
      Name
    >;
    handleWebhook: FunctionReference<
      "action",
      "internal",
      {
        payload: any;
        rawBody?: string;
        signature?: string;
        verifySignature?: boolean;
        config?: { authSecret: string };
      },
      { assemblyId: string; resultCount: number },
      Name
    >;
    getAssemblyStatus: FunctionReference<
      "query",
      "internal",
      { assemblyId: string },
      any,
      Name
    >;
    listAssemblies: FunctionReference<
      "query",
      "internal",
      { status?: string; userId?: string; limit?: number },
      Array<any>,
      Name
    >;
    listResults: FunctionReference<
      "query",
      "internal",
      { assemblyId: string; stepName?: string; limit?: number },
      Array<any>,
      Name
    >;
    storeAssemblyMetadata: FunctionReference<
      "mutation",
      "internal",
      { assemblyId: string; userId?: string; fields?: any },
      any,
      Name
    >;
  };
};
