export const sleep = (ms: number) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
