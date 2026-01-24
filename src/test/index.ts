/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import schema from "../component/schema.ts";

export const modules = import.meta.glob("../component/**/*.*s");

export function createTransloaditTest() {
  return convexTest(schema, modules);
}
