import {mountWeb} from "./web.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import {
  accountRouter,
  accountError,
  type AccountsOptions,
} from "./accounts.js";
type Options = {
  origin: string;
  origins?: string[];
  checkDatabase: () => Promise<void>;
  accounts?: AccountsOptions;
  trustProxy?: boolean;
  webDirectory?: string;
};
export function createApp({
  origin,
  origins = [origin],
  checkDatabase,
  accounts,
  trustProxy = false,
  webDirectory,
}: Options) {
  const app = express();
  app.disable("x-powered-by");
  if (trustProxy) app.set("trust proxy", 1);
  app.use(helmet({contentSecurityPolicy:{directives:{connectSrc:["'self'",...origins,...origins.map(value=>{
    const url=new URL(value);url.protocol=url.protocol==="https:"?"wss:":"ws:";return url.origin;
  })]}}}));
  app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      // Запрещаем form POST и чужой Origin, в том числе для login/register.
      if (
        !origins.includes(req.get("Origin") ?? "") ||
        !req.is("application/json")
      ) {
        res
          .status(403)
          .json({
            message: "Запрос запрещён. Откройте сайт по разрешённому адресу",
          });
        return;
      }
    }
    next();
  });
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "StudentConnect API" });
  });
  app.get("/api/ready", async (_req, res) => {
    try {
      await checkDatabase();
      res.json({ status: "ok", database: "connected" });
    } catch {
      res
        .status(503)
        .json({
          status: "unavailable",
          database: "disconnected",
          message: "База данных недоступна",
        });
    }
  });
  if (accounts) app.use("/api", accountRouter(accounts));
  if(webDirectory)mountWeb(app,webDirectory);
  app.use((_req, res) => {
    res.status(404).json({ message: "Маршрут не найден" });
  });
  app.use(accountError);
  return app;
}
