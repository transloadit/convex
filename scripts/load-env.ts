import { config } from "dotenv";

export const loadEnv = () => {
  const result = config({ path: process.env.DOTENV_CONFIG_PATH });
  if (result.error) {
    return;
  }
};
