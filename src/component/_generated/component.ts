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

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    lib: {
      completeStoredAssetDeletion: FunctionReference<
        "mutation",
        "internal",
        { assetId: string; workspace: string },
        { deleted: number },
        Name
      >;
      createAssembly: FunctionReference<
        "action",
        "internal",
        {
          additionalParams?: Record<string, any>;
          config: { authKey: string; authSecret: string };
          expires?: string;
          fields?: Record<string, any>;
          notifyUrl?: string;
          numExpectedUploadFiles?: number;
          steps?: Record<string, any>;
          templateId?: string;
          userId?: string;
        },
        { assemblyId: string; data: any },
        Name
      >;
      createAssemblyOptions: FunctionReference<
        "action",
        "internal",
        {
          additionalParams?: Record<string, any>;
          config: { authKey: string; authSecret: string };
          expires?: string;
          fields?: Record<string, any>;
          notifyUrl?: string;
          numExpectedUploadFiles?: number;
          steps?: Record<string, any>;
          templateId?: string;
          userId?: string;
        },
        { fields?: Record<string, any>; params: string; signature: string },
        Name
      >;
      failStoredAssetDeletion: FunctionReference<
        "mutation",
        "internal",
        { assetId: string; error: string; workspace: string },
        null,
        Name
      >;
      getAssemblyStatus: FunctionReference<
        "query",
        "internal",
        { assemblyId: string },
        {
          _creationTime: number;
          _id: string;
          assemblyId: string;
          createdAt: number;
          error?: any;
          fields?: Record<string, any>;
          message?: string;
          notifyUrl?: string;
          numExpectedUploadFiles?: number;
          ok?: string;
          raw?: any;
          results?: Record<string, Array<any>>;
          status?: string;
          templateId?: string;
          updatedAt: number;
          uploads?: Array<any>;
          userId?: string;
        } | null,
        Name
      >;
      getStoredAsset: FunctionReference<
        "query",
        "internal",
        { assetId: string; versionId: string; workspace: string },
        {
          _creationTime: number;
          _id: string;
          album?: string;
          assemblyId: string;
          asset: {
              asset_id: string;
              has_alpha?: boolean;
              height?: number;
              md5hash?: string;
              mime: string | null;
              path: string;
              sha256?: string;
              size: number;
              thumbhash?: string;
              version_id: string;
              width?: number;
              workspace: string;
            };
          createdAt: number;
          deletedAt?: number;
          deletionAttempts?: number;
          deletionError?: string;
          deletionRequestedAt?: number;
          originalId?: string | Array<string | null>;
          resultId: string;
          stepName: string;
          uploadId?: string;
          userId?: string;
        } | null,
        Name
      >;
      handleWebhook: FunctionReference<
        "action",
        "internal",
        {
          config?: { authSecret: string };
          payload: any;
          rawBody?: string;
          signature?: string;
          storage?: { workspace: string };
          verifySignature?: boolean;
        },
        {
          assemblyId: string;
          ok?: string;
          resultCount: number;
          status?: string;
          storedAssetCount?: number;
        },
        Name
      >;
      listAlbumResults: FunctionReference<
        "query",
        "internal",
        { album: string; limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          album?: string;
          assemblyId: string;
          createdAt: number;
          mime?: string;
          name?: string;
          raw: any;
          resultId?: string;
          size?: number;
          sslUrl?: string;
          stepName: string;
          userId?: string;
        }>,
        Name
      >;
      listAssemblies: FunctionReference<
        "query",
        "internal",
        { limit?: number; status?: string; userId?: string },
        Array<{
          _creationTime: number;
          _id: string;
          assemblyId: string;
          createdAt: number;
          error?: any;
          fields?: Record<string, any>;
          message?: string;
          notifyUrl?: string;
          numExpectedUploadFiles?: number;
          ok?: string;
          raw?: any;
          results?: Record<string, Array<any>>;
          status?: string;
          templateId?: string;
          updatedAt: number;
          uploads?: Array<any>;
          userId?: string;
        }>,
        Name
      >;
      listResults: FunctionReference<
        "query",
        "internal",
        { assemblyId: string; limit?: number; stepName?: string },
        Array<{
          _creationTime: number;
          _id: string;
          album?: string;
          assemblyId: string;
          createdAt: number;
          mime?: string;
          name?: string;
          raw: any;
          resultId?: string;
          size?: number;
          sslUrl?: string;
          stepName: string;
          userId?: string;
        }>,
        Name
      >;
      listStoredAssetDeletions: FunctionReference<
        "query",
        "internal",
        {
          album: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            assetId: string;
            deletionAttempts: number;
            deletionError?: string;
            deletionRequestedAt: number;
            paths: Array<string>;
            rows: number;
            workspace: string;
          }>;
        },
        Name
      >;
      listStoredAssets: FunctionReference<
        "query",
        "internal",
        {
          album: string;
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            _creationTime: number;
            _id: string;
            album?: string;
            assemblyId: string;
            asset: {
                asset_id: string;
                has_alpha?: boolean;
                height?: number;
                md5hash?: string;
                mime: string | null;
                path: string;
                sha256?: string;
                size: number;
                thumbhash?: string;
                version_id: string;
                width?: number;
                workspace: string;
              };
            createdAt: number;
            deletedAt?: number;
            deletionAttempts?: number;
            deletionError?: string;
            deletionRequestedAt?: number;
            originalId?: string | Array<string | null>;
            resultId: string;
            stepName: string;
            uploadId?: string;
            userId?: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      listStoredAssetsForAssembly: FunctionReference<
        "query",
        "internal",
        { assemblyId: string; limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          album?: string;
          assemblyId: string;
          asset: {
              asset_id: string;
              has_alpha?: boolean;
              height?: number;
              md5hash?: string;
              mime: string | null;
              path: string;
              sha256?: string;
              size: number;
              thumbhash?: string;
              version_id: string;
              width?: number;
              workspace: string;
            };
          createdAt: number;
          deletedAt?: number;
          deletionAttempts?: number;
          deletionError?: string;
          deletionRequestedAt?: number;
          originalId?: string | Array<string | null>;
          resultId: string;
          stepName: string;
          uploadId?: string;
          userId?: string;
        }>,
        Name
      >;
      purgeAlbum: FunctionReference<
        "mutation",
        "internal",
        { album: string; deleteAssemblies?: boolean },
        { deletedAssemblies: number; deletedResults: number },
        Name
      >;
      queueWebhook: FunctionReference<
        "action",
        "internal",
        {
          config?: { authSecret: string };
          payload: any;
          rawBody?: string;
          signature?: string;
          storage?: { workspace: string };
          verifySignature?: boolean;
        },
        { assemblyId: string; queued: boolean },
        Name
      >;
      refreshAssembly: FunctionReference<
        "action",
        "internal",
        {
          assemblyId: string;
          config?: { authKey: string; authSecret: string };
          expectedFields?: Record<string, string>;
          storage?: { workspace: string };
        },
        {
          assemblyId: string;
          ok?: string;
          resultCount: number;
          status?: string;
          storedAssetCount?: number;
        },
        Name
      >;
      requestStoredAssetDeletion: FunctionReference<
        "mutation",
        "internal",
        { album: string; createdBefore: number; limit?: number },
        {
          hasMore: boolean;
          requested: Array<{ assetId: string; workspace: string }>;
        },
        Name
      >;
      storeAssemblyMetadata: FunctionReference<
        "mutation",
        "internal",
        { assemblyId: string; fields?: Record<string, any>; userId?: string },
        {
          _creationTime: number;
          _id: string;
          assemblyId: string;
          createdAt: number;
          error?: any;
          fields?: Record<string, any>;
          message?: string;
          notifyUrl?: string;
          numExpectedUploadFiles?: number;
          ok?: string;
          raw?: any;
          results?: Record<string, Array<any>>;
          status?: string;
          templateId?: string;
          updatedAt: number;
          uploads?: Array<any>;
          userId?: string;
        } | null,
        Name
      >;
    };
  };
