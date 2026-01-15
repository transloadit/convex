import transloadit from "@transloadit/convex/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(transloadit);

export default app;
