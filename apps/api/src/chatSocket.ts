import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { COOKIE, csrfFor, hashToken } from "./security.js";
import type { ChatService } from "./chat.js";
function sessionCookie(header: string | undefined) {
  const value = header
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  // Сессионный cookie содержит только 64 hex-символа, без произвольных строк.
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function installChatSocket(
  server: HttpServer,
  {
    db,
    chat,
    origins,
  }: { db: PrismaClient; chat: ChatService; origins: string[] },
) {
  const io = new Server(server, {
    cors: { origin: origins, credentials: true },
    maxHttpBufferSize: 16 * 1024,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      // При GET polling с того же origin браузер может не прислать Origin.
      // Sec-Fetch-Site разрешает только same-origin; сессия и CSRF проверяются ниже.
      const allowed =
        typeof origin === "string"
          ? origins.includes(origin)
          : origin === undefined &&
            req.headers["sec-fetch-site"] === "same-origin";
      callback(null, allowed);
    },
  });
  async function valid(hash: string, userId?: string) {
    const session = await db.session.findUnique({
      where: { tokenHash: hash },
      select: {
        userId: true,
        expiresAt: true,
        user: {
          select: {
            emailVerifiedAt: true,
            group: { select: { institution: true } },
          },
        },
      },
    });
    return session &&
      session.expiresAt.getTime() > Date.now() &&
      session.user.emailVerifiedAt &&
      session.user.group.institution === "МИЭТ, колледж" &&
      (!userId || userId === session.userId)
      ? session
      : null;
  }
  io.use(async (socket, next) => {
    try {
      const token = sessionCookie(socket.request.headers.cookie),
        csrf = socket.handshake.auth?.csrfToken;
      if (
        !token ||
        typeof csrf !== "string" ||
        !/^[a-f0-9]{64}$/.test(csrf) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(csrfFor(token)))
      ) {
        next(new Error("Необходима авторизация"));
        return;
      }
      const hash = hashToken(token),
        session = await valid(hash);
      if (!session) {
        next(new Error("Сессия недоступна. Войдите снова"));
        return;
      }
      socket.data.userId = session.userId;
      socket.data.sessionHash = hash;
      socket.data.expiresAt = session.expiresAt.getTime();
      next();
    } catch {
      next(new Error("Не удалось проверить сессию"));
    }
  });
  io.on("connection", (socket) => {
    void socket.join(`user:${socket.data.userId}`);
    void socket.join(`session:${socket.data.sessionHash}`);
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.expiresAt - Date.now()),
    );
    timer.unref();
    socket.on("disconnect", () => clearTimeout(timer));
    // Клиент не может выбирать комнаты, адресата или выдавать себя за отправителя.
    // Изменения проходят через HTTP с сессией и CSRF; здесь только доставка после commit.
  });
  const delivery = new Map<string, Promise<void>>();
  function deliver(users: string[], event: string, payload: unknown) {
    // Очередь на каждого адресата сохраняет порядок при асинхронной повторной проверке сессии.
    for (const user of new Set(users)) {
      const work = (delivery.get(user) ?? Promise.resolve())
        .then(async () => {
          for (const socket of await io.in(`user:${user}`).fetchSockets()) {
            if (!(await valid(socket.data.sessionHash, user))) {
              socket.disconnect(true);
              continue;
            }
            socket.emit(event, payload);
          }
        })
        .catch(() => {
          /* Сохранённое сообщение будет получено из истории при повторном подключении. */
        });
      delivery.set(user, work);
      void work.finally(() => {
        if (delivery.get(user) === work) delivery.delete(user);
      });
    }
  }
  const changed = (users: string[]) => deliver(users, "chat:changed", {});
  const message = ({ users, message }: { users: string[]; message: unknown }) =>
    deliver(users, "chat:message", message);
  const access = (users: string[]) => deliver(users, "chat:access", {});
  const revoke = (hash: string) =>
    io.in(`session:${hash}`).disconnectSockets(true);
  chat.on("changed", changed);
  chat.on("message", message);
  chat.on("sessionRevoked", revoke);
  chat.on("access", access);
  const interval = setInterval(() => {
    for (const socket of io.sockets.sockets.values())
      void valid(socket.data.sessionHash, socket.data.userId)
        .then((session) => {
          if (!session) socket.disconnect(true);
        })
        .catch(() => socket.disconnect(true));
  }, 30000);
  interval.unref();
  server.once("close", () => {
    clearInterval(interval);
    chat.off("changed", changed);
    chat.off("message", message);
    chat.off("sessionRevoked", revoke);
    chat.off("access", access);
  });
  return io;
}
