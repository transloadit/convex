type Mode = "local" | "cloud";

export type RuntimeConfig = {
  authKey: string;
  authSecret: string;
  mode: Mode;
  useRemote: boolean;
  remoteUrl: string;
  remoteAdminKey: string;
  shouldRun: boolean;
};

export const getRuntimeConfig = (): RuntimeConfig => {
  const authKey = process.env.TRANSLOADIT_KEY ?? "";
  const authSecret = process.env.TRANSLOADIT_SECRET ?? "";
  const modeEnv = process.env.E2E_MODE ?? "local";
  const mode: Mode = modeEnv === "cloud" ? "cloud" : "local";
  const useRemote = mode === "cloud";
  const remoteUrl = process.env.E2E_REMOTE_URL ?? "";
  const remoteAdminKey = process.env.E2E_REMOTE_ADMIN_KEY ?? "";
  const shouldRun = useRemote || Boolean(authKey && authSecret);
  return {
    authKey,
    authSecret,
    mode,
    useRemote,
    remoteUrl,
    remoteAdminKey,
    shouldRun,
  };
};

export const runtime = getRuntimeConfig();
