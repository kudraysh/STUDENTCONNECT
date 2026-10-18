import {fileURLToPath} from "node:url";
import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";
import { ChatService } from "./chat.js";
import { installChatSocket } from "./chatSocket.js";
import { config, allowedOrigins } from "./config.js";
import { createMailer } from "./mail.js";
import { createApp } from "./app.js";
const prisma = new PrismaClient();
const chat = new ChatService(prisma);
const app = createApp({
  webDirectory: config.SERVE_WEB === "1" ? fileURLToPath(new URL("../../web/dist/",import.meta.url)) : undefined,
  origin: config.WEB_ORIGIN,
  origins: allowedOrigins,
  trustProxy: config.TRUST_PROXY === "1",
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  accounts: {
    db: prisma,
    chat,
    mailer: createMailer(config),
    origin: new URL(config.WEB_ORIGIN).origin,
    cookie: {
      production: config.NODE_ENV === "production",
      sameSite: config.COOKIE_SAME_SITE,
    },
  },
});
const server = createServer(app);
const io = installChatSocket(server, {
  db: prisma,
  chat,
  origins: allowedOrigins,
});
server.listen(config.PORT, "0.0.0.0", () =>
  console.log(`API: http://localhost:${config.PORT}`),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 10000).unref();
  try {
    await new Promise<void>((resolve) => {
      void io.close(() => resolve());
    });
    await prisma.$disconnect();
    clearTimeout(timer);
    process.exit(0);
  } catch {
    clearTimeout(timer);
    process.exit(1);
  }
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
