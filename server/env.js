require("dotenv").config();
const { cleanEnv, num, str, bool } = require("envalid");
const { readFileSync } = require("node:fs");

const supportedDBClients = [
  "pg",
  "pg-native",
  "sqlite3",
  "better-sqlite3",
  "mysql",
  "mysql2"
];

// make sure custom alphabet is not empty
if (process.env.LINK_CUSTOM_ALPHABET === "") {
  delete process.env.LINK_CUSTOM_ALPHABET;
}

// make sure jwt secret is not empty
if (process.env.JWT_SECRET === "") {
  delete process.env.JWT_SECRET;
}

// if is started with the --production argument, then set NODE_ENV to production
if (process.argv.includes("--production")) {
  process.env.NODE_ENV = "production";
}

// LinkPulse fix: envalid assumes production when NODE_ENV is unset at all
// ("If NODE_ENV is not set, assume production" - see envalid's own docs).
// `npm run dev` never sets NODE_ENV, so without this the app would silently
// boot in "production" mode locally: short links would be generated with
// https://localhost instead of http://, and the JWT cookie would be marked
// Secure (browsers then refuse to send it back over plain HTTP, breaking
// login). Defaulting to "development" here - only when NODE_ENV is still
// unset after the --production check above - keeps `npm start` behaving
// exactly as before while fixing local development out of the box.
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "development";
}

const spec = {
  // Development mode unless the application is started with --production
  // (or NODE_ENV is explicitly set to "production")
  PORT: num({ default: 3000 }),
  SITE_NAME: str({ example: "LinkPulse", default: "LinkPulse" }),
  DEFAULT_DOMAIN: str({ example: "linkpulse.app", default: "localhost:3000" }),
  LINK_LENGTH: num({ default: 6 }),
  LINK_CUSTOM_ALPHABET: str({
    default: "abcdefghkmnpqrstuvwxyzABCDEFGHKLMNPQRSTUVWXYZ23456789"
  }),
  TRUST_PROXY: bool({ default: true }),

  DB_CLIENT: str({
    choices: supportedDBClients,
    default: "better-sqlite3"
  }),
  DB_FILENAME: str({ default: "db/data" }),
  DB_HOST: str({ default: "localhost" }),
  DB_PORT: num({ default: 5432 }),
  DB_NAME: str({ default: "linkpulse" }),
  DB_USER: str({ default: "postgres" }),
  DB_PASSWORD: str({ default: "" }),
  DB_SSL: bool({ default: false }),
  DB_POOL_MIN: num({ default: 0 }),
  DB_POOL_MAX: num({ default: 10 }),

  REDIS_ENABLED: bool({ default: false }),
  REDIS_HOST: str({ default: "127.0.0.1" }),
  REDIS_PORT: num({ default: 6379 }),
  REDIS_PASSWORD: str({ default: "" }),
  REDIS_DB: num({ default: 0 }),

  DISALLOW_ANONYMOUS_LINKS: bool({ default: true }),
  DISALLOW_REGISTRATION: bool({ default: true }),
  DISALLOW_LOGIN_FORM: bool({ default: false }),

  SERVER_IP_ADDRESS: str({ default: "" }),
  SERVER_CNAME_ADDRESS: str({ default: "" }),

  CUSTOM_DOMAIN_USE_HTTPS: bool({ default: false }),

  JWT_SECRET: str({ devDefault: "securekey" }),

  MAIL_ENABLED: bool({ default: false }),
  MAIL_HOST: str({ default: "" }),
  MAIL_PORT: num({ default: 587 }),
  MAIL_SECURE: bool({ default: false }),
  MAIL_USER: str({ default: "" }),
  MAIL_FROM: str({
    default: "",
    example: "LinkPulse <support@yourdomain.com>"
  }),
  MAIL_PASSWORD: str({ default: "" }),

  OIDC_ENABLED: bool({ default: false }),
  OIDC_ISSUER: str({ default: "" }),
  OIDC_PROMPT: str({ default: "" }),
  OIDC_CLIENT_ID: str({ default: "" }),
  OIDC_CLIENT_SECRET: str({ default: "" }),
  OIDC_SCOPE: str({ default: "openid profile email" }),
  OIDC_EMAIL_CLAIM: str({ default: "email" }),
  OIDC_BUTTON_TEXT: str({ default: "Log in with OIDC" }),

  ENABLE_RATE_LIMIT: bool({ default: false }),

  REPORT_EMAIL: str({ default: "" }),
  CONTACT_EMAIL: str({ default: "" }),

  NODE_APP_INSTANCE: num({ default: 0 }),
};

for (const key in spec) {
  const file_key = key + "_FILE";

  if (!(file_key in process.env)) continue;

  try {
    process.env[key] = readFileSync(process.env[file_key], "utf8").trim();
  } catch {
    // on error, env_FILE just doesn't get applied.
  }
}

const env = cleanEnv(process.env, spec);

module.exports = env;