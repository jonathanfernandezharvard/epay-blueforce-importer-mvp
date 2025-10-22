import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'EPAY_PASSWORD',
      'AZURE_CLIENT_SECRET'
    ],
    remove: true,
  },
});
