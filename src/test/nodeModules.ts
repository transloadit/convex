import * as apiModule from '../component/_generated/api.ts'
import * as componentModule from '../component/_generated/component.ts'
import * as dataModelModule from '../component/_generated/dataModel.ts'
import * as serverModule from '../component/_generated/server.ts'
import * as apiUtilsModule from '../component/apiUtils.ts'
import * as convexConfigModule from '../component/convex.config.ts'
import * as libModule from '../component/lib.ts'
import * as schemaModule from '../component/schema.ts'

export const modules: Record<string, () => Promise<unknown>> = {
  '../component/apiUtils.ts': async () => apiUtilsModule,
  '../component/lib.ts': async () => libModule,
  '../component/convex.config.ts': async () => convexConfigModule,
  '../component/schema.ts': async () => schemaModule,
  '../component/_generated/api.ts': async () => apiModule,
  '../component/_generated/component.ts': async () => componentModule,
  '../component/_generated/dataModel.ts': async () => dataModelModule,
  '../component/_generated/server.ts': async () => serverModule,
}
