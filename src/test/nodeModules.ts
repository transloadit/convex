import * as apiModule from "../component/_generated/api.js";
import * as componentModule from "../component/_generated/component.js";
import * as dataModelModule from "../component/_generated/dataModel.js";
import * as serverModule from "../component/_generated/server.js";
import * as apiUtilsModule from "../component/apiUtils.js";
import * as convexConfigModule from "../component/convex.config.js";
import * as libModule from "../component/lib.js";
import * as schemaModule from "../component/schema.js";

export const modules: Record<string, () => Promise<unknown>> = {
  "../component/apiUtils.js": async () => apiUtilsModule,
  "../component/lib.js": async () => libModule,
  "../component/convex.config.js": async () => convexConfigModule,
  "../component/schema.js": async () => schemaModule,
  "../component/_generated/api.js": async () => apiModule,
  "../component/_generated/component.js": async () => componentModule,
  "../component/_generated/dataModel.js": async () => dataModelModule,
  "../component/_generated/server.js": async () => serverModule,
};
