type Mode = "local" | "cloud";
type AppVariant = "fixture" | "example";

export type RuntimeConfig = {
  authKey: string;
  authSecret: string;
  mode: Mode;
  useRemote: boolean;
  remoteUrl: string;
  remoteAdminKey: string;
  remoteNotifyUrl: string;
  appVariant: AppVariant;
  templateId: string;
  useTemplate: boolean;
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
  const remoteNotifyUrl = process.env.E2E_REMOTE_NOTIFY_URL ?? "";
  const appVariant: AppVariant =
    process.env.E2E_APP === "example" ? "example" : "fixture";
  const templateId =
    process.env.TRANSLOADIT_TEMPLATE_ID ??
    process.env.VITE_TRANSLOADIT_TEMPLATE_ID ??
    "";
  const useTemplate =
    process.env.E2E_USE_TEMPLATE === "1" || appVariant === "example";
  const shouldRun = useRemote || Boolean(authKey && authSecret);

  return {
    authKey,
    authSecret,
    mode,
    useRemote,
    remoteUrl,
    remoteAdminKey,
    remoteNotifyUrl,
    appVariant,
    templateId,
    useTemplate,
    shouldRun,
  };
};

export const runtime = getRuntimeConfig();
