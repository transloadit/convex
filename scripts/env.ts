import { config } from 'dotenv'

export const loadEnv = () => {
  config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true })
}
