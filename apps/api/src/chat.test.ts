import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { io as client, type Socket } from "socket.io-client";
import { createApp } from "./app.js";
import { ChatService } from "./chat.js";
import { installChatSocket } from "./chatSocket.js";
import { newToken, hashToken, csrfFor } from "./security.js";

test(
  "Этап 5: HTTP, история, Socket.IO и разрешения на телефон",
  { timeout: 120000 },
  async (t) => {
    const pg = await PGlite.create();
    const dbServer = new PGLiteSocketServer({
      db: pg,
      port: 0,
      host: "127.0.0.1",
    });
    for (const name of (
      await readdir(new URL("../prisma/migrations/", import.meta.url))
    )
      .filter((n) => /^\d/.test(n))
      .sort())
      await pg.exec(
        await readFile(
          new URL(
            `../prisma/migrations/${name}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
    await dbServer.start();
    const db = new PrismaClient({
      datasourceUrl: `postgresql://postgres:postgres@${dbServer.getServerConn()}/postgres?connection_limit=1&sslmode=disable`,
    });
    const origin = "http://localhost:5173",
      chat = new ChatService(db);
    const app = createApp({
      origin,
      checkDatabase: async () => {},
      accounts: {
        db,
        chat,
        origin,
        rateLimitMax: 1000,
        cookie: { production: false, sameSite: "lax" },
        mailer: { mode: "console", async sendVerification() {} },
      },
    });
    const server = createServer(app),
      io = installChatSocket(server, { db, chat, origins: [origin] });
    const sockets: Socket[] = [];
    t.after(async () => {
      for (const s of sockets) s.disconnect();
      await new Promise<void>((resolve) => {
        void io.close(() => resolve());
      });
      await db.$disconnect();
      await dbServer.stop();
      await pg.close();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const url = `http://127.0.0.1:${address.port}`;
    const group = await db.studyGroup.create({
      data: { name: "ИС-21", course: 2 },
    });
    const category = await db.category.create({ data: { name: "Видеоигры" } });
    const interest = await db.interest.create({
      data: { name: "CS2", normalizedName: "cs2", categoryId: category.id },
    });
    async function actor(
      firstName: string,
      phone: string | null,
      verified = true,
    ) {
      const user = await db.user.create({
        data: {
          firstName,
          lastName: "Студент",
          email: `${randomUUID()}@test.invalid`,
          passwordHash: "fixture-no-login",
          phone,
          course: 2,
          groupId: group.id,
          emailVerifiedAt: verified ? new Date() : null,
          interests: { create: { interestId: interest.id } },
        },
      });
      const token = newToken();
      await db.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      return { id: user.id, token, csrf: csrfFor(token) };
    }
    const a = await actor("Алиса", "+79001110000"),
      b = await actor("Борис", "+79002220000"),
      c = await actor("Карина", null),
      pending = await actor("Неподтверждённый", null, false);
    type Actor = typeof a;
    const get = (who: Actor, path: string) =>
      request(server)
        .get(`/api/chat${path}`)
        .set("Cookie", `sc_session=${who.token}`);
    const post = (who: Actor, path: string, body: object = {}) =>
      request(server)
        .post(`/api/chat${path}`)
        .set("Origin", origin)
        .set("Cookie", `sc_session=${who.token}`)
        .set("X-CSRF-Token", who.csrf)
        .send(body);
    const send = (
      who: Actor,
      conversation: string,
      text: string,
      clientId = randomUUID(),
    ) =>
      post(who, `/conversations/${conversation}/messages`, { text, clientId });
    async function open(who: Actor, peer: Actor) {
      const r = await post(who, "/conversations", { peerId: peer.id });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.id as string;
    }
    function wait<T = unknown>(
      socket: Socket,
      event: string,
      timeout = 5000,
    ): Promise<T> {
      return new Promise((resolve, reject) => {
        const listener = (value: T) => {
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => {
          socket.off(event, listener);
          reject(new Error(`Не получено событие ${event}`));
        }, timeout);
        socket.once(event, listener);
      });
    }
    function makeSocket(
      who?: Actor,
      extra: { origin?: string; csrf?: string } = {},
    ) {
      const s = client(url, {
        autoConnect: false,
        transports: ["websocket"],
        reconnection: false,
        auth: { csrfToken: extra.csrf ?? who?.csrf },
        extraHeaders: {
          Origin: extra.origin ?? origin,
          ...(who ? { Cookie: `sc_session=${who.token}` } : {}),
        },
      });
      sockets.push(s);
      return s;
    }
    async function connect(who: Actor) {
      const s = makeSocket(who);
      const ready = wait(s, "connect");
      s.connect();
      await ready;
      return s;
    }
    let ab = "",
      ac = "",
      firstMessage = 0;
    await t.test(
      "сессия, подтверждение, Origin и CSRF обязательны",
      async () => {
        assert.equal(
          (await request(server).get("/api/chat/conversations")).status,
          401,
        );
        assert.equal((await get(pending, "/conversations")).status, 403);
        const missing = await request(server)
          .post("/api/chat/conversations")
          .set("Origin", origin)
          .set("Cookie", `sc_session=${a.token}`)
          .send({ peerId: b.id });
        assert.equal(missing.status, 403);
        assert.equal(
          (await post(a, "/conversations", { peerId: a.id })).status,
          400,
        );
        assert.equal(
          (await post(a, "/conversations", { peerId: pending.id })).status,
          403,
        );
      },
    );
    await t.test(
      "одна пара пользователей имеет один диалог в обоих направлениях",
      async () => {
        ab = await open(a, b);
        assert.equal(await open(b, a), ab);
        assert.equal(await db.conversation.count(), 1);
        const both = await Promise.all([open(a, c), open(c, a)]);
        assert.equal(both[0], both[1]);
        ac = both[0];
      },
    );
    await t.test(
      "посторонний не читает, не пишет и не отмечает чужой диалог",
      async () => {
        for (const path of [
          `/conversations/${ab}`,
          `/conversations/${ab}/messages`,
        ])
          assert.equal((await get(c, path)).status, 404);
        assert.equal((await send(c, ab, "Чужое сообщение")).status, 404);
        assert.equal(
          (await post(c, `/conversations/${ab}/read`, { messageId: 1 })).status,
          404,
        );
        assert.equal((await post(c, `/conversations/${ab}/phone`)).status, 404);
      },
    );
    await t.test(
      "только текст до 4000 символов, повторная отправка идемпотентна",
      async () => {
        for (const text of ["   ", "x".repeat(4001)])
          assert.equal((await send(a, ab, text)).status, 400);
        const nonce = randomUUID(),
          sent = await send(a, ab, "Привет, Борис!\nИграем в CS2?", nonce);
        assert.equal(sent.status, 201);
        firstMessage = sent.body.message.id;
        const repeat = await send(
          a,
          ab,
          "Привет, Борис!\nИграем в CS2?",
          nonce,
        );
        assert.equal(repeat.body.message.id, firstMessage);
        assert.equal(await db.chatMessage.count(), 1);
        assert.equal(
          (await send(a, ab, "Изменённый текст", nonce)).status,
          409,
        );
        const parallelNonce = randomUUID();
        const parallel = await Promise.all([
          send(b, ab, "Да, давай!", parallelNonce),
          send(b, ab, "Да, давай!", parallelNonce),
        ]);
        assert.ok(parallel.every((r) => r.status === 201));
        assert.equal(parallel[0].body.message.id, parallel[1].body.message.id);
        assert.equal(await db.chatMessage.count(), 2);
        const forged = await post(a, `/conversations/${ac}/messages`, {
          text: "<script>только текст</script>",
          clientId: randomUUID(),
          senderId: c.id,
        });
        assert.equal(forged.status, 201);
        assert.equal(forged.body.message.senderId, a.id);
        assert.equal(forged.body.message.text, "<script>только текст</script>");
      },
    );
    await t.test(
      "непрочитанные раздельны, read-курсор монотонный и проверяет диалог",
      async () => {
        assert.equal((await get(b, "/unread")).body.unread, 1);
        assert.equal((await get(a, "/unread")).body.unread, 1);
        assert.equal((await get(c, "/unread")).body.unread, 1);
        assert.equal(
          (
            await post(b, `/conversations/${ab}/read`, {
              messageId: firstMessage,
            })
          ).status,
          200,
        );
        assert.equal((await get(b, "/unread")).body.unread, 0);
        assert.equal((await get(a, "/unread")).body.unread, 1);
        const foreign = await send(c, ac, "Сообщение в другом диалоге");
        assert.equal(foreign.status, 201);
        assert.equal(
          (
            await post(b, `/conversations/${ab}/read`, {
              messageId: foreign.body.message.id,
            })
          ).status,
          400,
        );
        const latest = (
          await get(a, `/conversations/${ab}/messages`)
        ).body.messages.at(-1).id;
        await post(b, `/conversations/${ab}/read`, { messageId: latest });
        await post(b, `/conversations/${ab}/read`, { messageId: firstMessage });
        const record = await db.conversation.findUniqueOrThrow({
          where: { id: ab },
        });
        assert.equal(
          record.userAId === b.id ? record.readA : record.readB,
          latest,
        );
      },
    );
    await t.test(
      "история пагинируется без пропусков, after восстанавливает пропущенное",
      async () => {
        await db.chatMessage.createMany({
          data: Array.from({ length: 205 }, (_, i) => ({
            conversationId: ab,
            senderId: a.id,
            clientId: randomUUID(),
            text: `История ${i}`,
          })),
        });
        const seen: number[] = [];
        let before: number | undefined;
        for (let page = 0; page < 4; page++) {
          const result = await get(
            b,
            `/conversations/${ab}/messages${before ? `?before=${before}` : ""}`,
          );
          assert.equal(result.status, 200);
          assert.ok(result.body.messages.length <= 100);
          seen.push(...result.body.messages.map((m: { id: number }) => m.id));
          if (!result.body.hasMore) break;
          before = result.body.messages[0].id;
        }
        assert.equal(new Set(seen).size, 207);
        assert.equal(seen.length, 207);
        const recovery = await get(
          b,
          `/conversations/${ab}/messages?after=${firstMessage}`,
        );
        assert.equal(recovery.status, 200);
        assert.equal(recovery.body.messages.length, 100);
        assert.equal(recovery.body.hasMore, true);
        assert.equal(
          (await get(b, `/conversations/${ab}/messages?before=1&after=2`))
            .status,
          400,
        );
      },
    );
    await t.test(
      "телефон и email скрыты в списке, истории и до одобрения",
      async () => {
        const result = await get(b, `/conversations/${ab}`);
        assert.equal(result.body.peer.hasPhone, true);
        assert.equal(result.body.phone, null);
        const list = await get(b, "/conversations");
        assert.equal(list.status, 200);
        assert.ok(
          list.body.conversations.some((d: { id: string }) => d.id === ab),
        );
        const text = JSON.stringify([
          list.body,
          (await get(b, `/conversations/${ab}/messages`)).body,
        ]);
        assert.ok(!text.includes("+79001110000"));
        assert.ok(!text.includes("passwordHash"));
        assert.ok(!text.includes("@test.invalid"));
        assert.equal((await post(a, `/conversations/${ac}/phone`)).status, 409);
      },
    );
    await t.test(
      "запрос, отклонение, повтор и защита устаревшего одобрения",
      async () => {
        const requested = await post(b, `/conversations/${ab}/phone`);
        assert.equal(requested.status, 201);
        const grant = requested.body.access;
        assert.equal((await get(a, "/unread")).body.phoneRequests, 1);
        const dialogs = (await get(a, "/conversations")).body.conversations;
        assert.equal(
          dialogs.find((d: { id: string }) => d.id === ab).phoneRequest,
          true,
        );
        assert.equal((await post(b, `/conversations/${ab}/phone`)).status, 409);
        assert.equal(
          (
            await post(b, `/phone/${grant.id}/approve`, {
              version: grant.version,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await post(c, `/phone/${grant.id}/approve`, {
              version: grant.version,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await post(a, `/phone/${grant.id}/reject`, {
              version: grant.version,
            })
          ).status,
          200,
        );
        assert.equal((await post(b, `/conversations/${ab}/phone`)).status, 429);
        await db.phoneAccess.update({
          where: { id: grant.id },
          data: { updatedAt: new Date(Date.now() - 61000) },
        });
        const again = await post(b, `/conversations/${ab}/phone`);
        assert.equal(again.status, 201);
        assert.equal(
          (
            await post(a, `/phone/${grant.id}/approve`, {
              version: grant.version,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await post(a, `/phone/${grant.id}/approve`, {
              version: again.body.access.version,
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      "разрешение видно только запросившему, отзыв немедленно закрывает API",
      async () => {
        const allowed = await get(b, `/conversations/${ab}`);
        assert.equal(allowed.body.phone, "+79001110000");
        assert.equal((await get(c, `/conversations/${ac}`)).body.phone, null);
        const grant = await db.phoneAccess.findUniqueOrThrow({
          where: { ownerId_requesterId: { ownerId: a.id, requesterId: b.id } },
        });
        assert.equal(
          (
            await post(a, `/phone/${grant.id}/revoke`, {
              version: grant.version,
            })
          ).status,
          200,
        );
        assert.equal((await get(b, `/conversations/${ab}`)).body.phone, null);
      },
    );
    await t.test(
      "смена и удаление телефона отзывают разрешения и ожидающие запросы",
      async () => {
        let grant = await db.phoneAccess.findUniqueOrThrow({
          where: { ownerId_requesterId: { ownerId: a.id, requesterId: b.id } },
        });
        await db.phoneAccess.update({
          where: { id: grant.id },
          data: { updatedAt: new Date(Date.now() - 61000) },
        });
        const requestB = await post(b, `/conversations/${ab}/phone`);
        await post(a, `/phone/${grant.id}/approve`, {
          version: requestB.body.access.version,
        });
        assert.equal((await post(c, `/conversations/${ac}/phone`)).status, 201);
        const patch = {
          firstName: "Алиса",
          lastName: "Студент",
          group: "ИС-21",
          course: 2,
          nickname: "",
          phone: "+79009999999",
          bio: "",
          interestIds: [interest.id],
        };
        const update = await request(server)
          .patch("/api/profile")
          .set("Cookie", `sc_session=${a.token}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", a.csrf)
          .send(patch);
        assert.equal(update.status, 200, JSON.stringify(update.body));
        assert.equal(
          await db.phoneAccess.count({
            where: { ownerId: a.id, status: "REVOKED" },
          }),
          2,
        );
        assert.equal((await get(b, `/conversations/${ab}`)).body.phone, null);
        const remove = await request(server)
          .patch("/api/profile")
          .set("Cookie", `sc_session=${a.token}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", a.csrf)
          .send({ ...patch, phone: "" });
        assert.equal(remove.status, 200);
        assert.equal(
          (await get(b, `/conversations/${ab}`)).body.peer.hasPhone,
          false,
        );
        assert.equal((await post(b, `/conversations/${ab}/phone`)).status, 409);
      },
    );
    await t.test(
      "Socket.IO отвергает гостя, чужой Origin, плохой CSRF и неподтверждённую почту",
      async () => {
        for (const [who, options] of [
          [undefined, {}],
          [a, { origin: "https://evil.invalid" }],
          [a, { csrf: "0".repeat(64) }],
          [pending, {}],
        ] as const) {
          const s = makeSocket(who, options);
          const failed = wait(s, "connect_error");
          s.connect();
          await failed;
          assert.equal(s.connected, false);
          s.disconnect();
        }
      },
    );
    await t.test(
      "polling без Origin работает только как same-origin с сессией и CSRF",
      async () => {
        const socket = client(url, {
          autoConnect: false,
          transports: ["polling"],
          reconnection: false,
          auth: { csrfToken: a.csrf },
          extraHeaders: {
            Cookie: `sc_session=${a.token}`,
            "Sec-Fetch-Site": "same-origin",
          },
        });
        sockets.push(socket);
        const ready = wait(socket, "connect");
        socket.connect();
        await ready;
        const incoming = wait<{ id: number }>(socket, "chat:message");
        const sent = await send(b, ab, "Проверка HTTP-транспорта");
        assert.equal(sent.status, 201);
        assert.equal((await incoming).id, sent.body.message.id);
        socket.disconnect();
      },
    );
    await t.test(
      "polling без Origin с cross-site отклоняется даже с cookie",
      async () => {
        const socket = client(url, {
          autoConnect: false,
          transports: ["polling"],
          reconnection: false,
          auth: { csrfToken: a.csrf },
          extraHeaders: {
            Cookie: `sc_session=${a.token}`,
            "Sec-Fetch-Site": "cross-site",
          },
        });
        sockets.push(socket);
        const failed = wait(socket, "connect_error");
        socket.connect();
        await failed;
        assert.equal(socket.connected, false);
        socket.disconnect();
      },
    );
    let socketA: Socket, socketB: Socket, socketC: Socket;
    await t.test(
      "Socket.IO доставляет сохранённое сообщение двум участникам, посторонний не получает его",
      async () => {
        socketA = await connect(a);
        socketB = await connect(b);
        socketC = await connect(c);
        const receivedA = wait<{ id: number; text: string }>(
            socketA,
            "chat:message",
          ),
          receivedB = wait<{ id: number; text: string }>(
            socketB,
            "chat:message",
          );
        const receivedC: unknown[] = [];
        socketC.on("chat:message", (value) => receivedC.push(value));
        socketC.emit("join", ab); // Неподдерживаемая попытка вступить в чужую комнату игнорируется.
        const sent = await send(a, ab, "Доставка в реальном времени");
        assert.equal(sent.status, 201);
        const [ma, mb] = await Promise.all([receivedA, receivedB]);
        assert.equal(ma.id, sent.body.message.id);
        assert.equal(mb.id, ma.id);
        assert.equal(mb.text, "Доставка в реальном времени");
        assert.ok(await db.chatMessage.findUnique({ where: { id: ma.id } }));
        assert.equal(receivedC.length, 0);
      },
    );
    await t.test(
      "после отключения история восстанавливает пропущенное без новой сессии",
      async () => {
        const last = (
          await get(b, `/conversations/${ab}/messages`)
        ).body.messages.at(-1).id;
        socketB.disconnect();
        const sent = await send(a, ab, "Пока ты был не в сети");
        assert.equal(sent.status, 201);
        socketB = await connect(b);
        const recovery = await get(
          b,
          `/conversations/${ab}/messages?after=${last}`,
        );
        assert.equal(
          recovery.body.messages.at(-1).text,
          "Пока ты был не в сети",
        );
      },
    );
    await t.test(
      "запрос и одобрение телефона дают сигнал только адресатам, без номера в Socket.IO",
      async () => {
        await db.user.update({
          where: { id: a.id },
          data: { phone: "+79001110000" },
        });
        const grant = await db.phoneAccess.findUniqueOrThrow({
          where: { ownerId_requesterId: { ownerId: a.id, requesterId: b.id } },
        });
        await db.phoneAccess.update({
          where: { id: grant.id },
          data: { updatedAt: new Date(Date.now() - 61000) },
        });
        const requestSignal = wait(socketA, "chat:access");
        const requested = await post(b, `/conversations/${ab}/phone`);
        assert.equal(requested.status, 201);
        assert.deepEqual(await requestSignal, {});
        const approvedSignal = wait(socketB, "chat:access");
        assert.equal(
          (
            await post(a, `/phone/${grant.id}/approve`, {
              version: requested.body.access.version,
            })
          ).status,
          200,
        );
        assert.deepEqual(await approvedSignal, {});
        assert.equal(
          (await get(b, `/conversations/${ab}`)).body.phone,
          "+79001110000",
        );
      },
    );
    await t.test("выход отзывает сессию и разрывает Socket.IO", async () => {
      const disconnected = wait(socketB, "disconnect");
      const result = await request(server)
        .post("/api/auth/logout")
        .set("Cookie", `sc_session=${b.token}`)
        .set("Origin", origin)
        .set("X-CSRF-Token", b.csrf)
        .send({});
      assert.equal(result.status, 200);
      await disconnected;
      assert.equal(socketB.connected, false);
      assert.equal((await get(b, "/conversations")).status, 401);
    });
    await t.test(
      "удалённая сессия не получает последующее сообщение",
      async () => {
        const temp = await actor("Отозванная", null),
          conversation = await open(a, temp),
          socket = await connect(temp);
        const received: unknown[] = [];
        socket.on("chat:message", (m) => received.push(m));
        await db.session.delete({
          where: { tokenHash: hashToken(temp.token) },
        });
        const disconnected = wait(socket, "disconnect");
        await send(a, conversation, "После отзыва");
        await disconnected;
        assert.equal(received.length, 0);
      },
    );
    await t.test(
      "активное соединение закрывается по сроку сессии",
      async () => {
        const short = await actor("Короткая", null);
        await db.session.update({
          where: { tokenHash: hashToken(short.token) },
          data: { expiresAt: new Date(Date.now() + 1500) },
        });
        const s = await connect(short);
        await wait(s, "disconnect", 5000);
        assert.equal(s.connected, false);
      },
    );
    await t.test("истёкший cookie не позволяет подключиться", async () => {
      const expired = await actor("Истёкший", null);
      await db.session.update({
        where: { tokenHash: hashToken(expired.token) },
        data: { expiresAt: new Date(Date.now() - 1) },
      });
      const s = makeSocket(expired);
      const failed = wait(s, "connect_error");
      s.connect();
      await failed;
      assert.equal(s.connected, false);
      s.disconnect();
    });
  },
);
