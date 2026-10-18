import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { createApp } from "./app.js";
import { newToken, hashToken, csrfFor } from "./security.js";

test(
  "Этап 4: мероприятия, ограничения, уведомления и параллельные HTTP-запросы",
  { timeout: 120000 },
  async (t) => {
    let pg: PGlite | undefined,
      socket: PGLiteSocketServer | undefined,
      admin: PrismaClient | undefined,
      schema = "";
    let db: PrismaClient;
    t.after(async () => {
      if (db) await db.$disconnect();
      if (admin) {
        await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
        await admin.$disconnect();
      }
      if (socket) await socket.stop();
      if (pg) await pg.close();
    });
    const files = (
      await readdir(new URL("../prisma/migrations/", import.meta.url))
    )
      .filter((name) => /^\d/.test(name))
      .sort();
    const native = process.env.EVENT_TEST_DATABASE_URL;
    if (native) {
      const url = new URL(native);
      if (!url.pathname.toLowerCase().includes("test"))
        throw new Error(
          "Для EVENT_TEST_DATABASE_URL используйте отдельную базу с test в имени",
        );
      schema = `sc_events_${randomBytes(8).toString("hex")}`;
      admin = new PrismaClient({ datasourceUrl: url.toString() });
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      url.searchParams.set("schema", schema);
      url.searchParams.set("connection_limit", "5");
      db = new PrismaClient({ datasourceUrl: url.toString() });
      for (const name of files) {
        const sql = await readFile(
          new URL(
            `../prisma/migrations/${name}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        );
        for (const statement of sql.split(";").filter((s) => s.trim()))
          await db.$executeRawUnsafe(statement);
      }
    } else {
      pg = await PGlite.create();
      for (const name of files)
        await pg.exec(
          await readFile(
            new URL(
              `../prisma/migrations/${name}/migration.sql`,
              import.meta.url,
            ),
            "utf8",
          ),
        );
      socket = new PGLiteSocketServer({ db: pg, port: 0, host: "127.0.0.1" });
      await socket.start();
      db = new PrismaClient({
        datasourceUrl: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1&sslmode=disable`,
      });
    }
    t.diagnostic(
      native
        ? "Настоящий PostgreSQL, пул из 5 соединений"
        : "PGlite: одно соединение. Проверка FOR UPDATE между настоящими PostgreSQL-соединениями не выполнялась.",
    );
    const origin = "http://localhost:5173";
    const app = createApp({
      origin,
      checkDatabase: async () => {},
      accounts: {
        db,
        origin,
        cookie: { production: false, sameSite: "lax" },
        rateLimitMax: 1000,
        mailer: { mode: "console", async sendVerification() {} },
      },
    });
    const group = await db.studyGroup.create({
      data: { name: "ИС-21", course: 2 },
    });
    const category = await db.category.create({ data: { name: "Спорт" } });
    async function actor(name: string, verified = true) {
      const user = await db.user.create({
        data: {
          firstName: name,
          lastName: "Студент",
          email: `${name}@test.invalid`,
          passwordHash: "fixture-not-for-login",
          phone: "+79000000000",
          emailVerifiedAt: verified ? new Date() : null,
          groupId: group.id,
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
    const owner = await actor("Организатор"),
      bob = await actor("Борис"),
      carol = await actor("Карина"),
      dave = await actor("Дмитрий"),
      pending = await actor("Неподтверждённый", false);
    type Actor = typeof owner;
    const get = (a: Actor, path: string) =>
      request(app)
        .get(`/api/events${path}`)
        .set("Cookie", `sc_session=${a.token}`);
    const post = (a: Actor, path: string, body: object = {}) =>
      request(app)
        .post(`/api/events${path}`)
        .set("Cookie", `sc_session=${a.token}`)
        .set("Origin", origin)
        .set("X-CSRF-Token", a.csrf)
        .send(body);
    const input = {
      title: "Баскетбол после пар",
      description: "Собираем команду поиграть в баскетбол после занятий.",
      place: "Площадка у колледжа",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      capacity: 3,
      categoryId: category.id,
    };
    let eventId = "",
      bobApplication = "",
      carolApplication = "";
    async function application(a: Actor, id = eventId) {
      const result = await post(a, `/${id}/apply`);
      assert.equal(result.status, 201, JSON.stringify(result.body));
      return (
        await db.eventApplication.findUniqueOrThrow({
          where: { eventId_userId: { eventId: id, userId: a.id } },
        })
      ).id;
    }
    async function accept(id: string, event = eventId) {
      return post(owner, `/${event}/applications/${id}/accept`);
    }
    await t.test(
      "авторизация, подтверждение, CSRF и колледж обязательны",
      async () => {
        assert.equal((await request(app).get("/api/events")).status, 401);
        assert.equal((await get(pending, "")).status, 403);
        const university = await actor("Университет");
        const universityGroup = await db.studyGroup.create({
          data: { name: "УНИ-21", course: 2, institution: "МИЭТ, университет" },
        });
        await db.user.update({
          where: { id: university.id },
          data: { groupId: universityGroup.id },
        });
        assert.equal((await get(university, "")).status, 403);
        assert.equal((await post(university, "", input)).status, 403);
        const csrf = await request(app)
          .post("/api/events")
          .set("Cookie", `sc_session=${owner.token}`)
          .set("Origin", origin)
          .send(input);
        assert.equal(csrf.status, 403);
        const evil = await request(app)
          .post("/api/events")
          .set("Cookie", `sc_session=${owner.token}`)
          .set("Origin", "https://evil.invalid")
          .set("X-CSRF-Token", owner.csrf)
          .send(input);
        assert.equal(evil.status, 403);
      },
    );
    await t.test(
      "создание валидирует дату, категорию, вместимость и обязательные поля",
      async () => {
        for (const invalid of [
          { ...input, title: "а" },
          { ...input, description: "" },
          { ...input, place: "" },
          { ...input, capacity: 1 },
          { ...input, capacity: 201 },
          { ...input, startsAt: "tomorrow" },
          { ...input, startsAt: new Date(Date.now() - 1000).toISOString() },
          { ...input, categoryId: "missing" },
        ])
          assert.equal((await post(owner, "", invalid)).status, 400);
        assert.equal(await db.event.count(), 0);
      },
    );
    await t.test(
      "организатор создаётся участником и занимает одно место",
      async () => {
        const result = await post(owner, "", input);
        assert.equal(result.status, 201, JSON.stringify(result.body));
        eventId = result.body.event.id;
        assert.equal(result.body.event.participants, 1);
        assert.equal(result.body.event.free, 2);
        assert.equal(result.body.event.isOrganizer, true);
        assert.equal((await get(owner, "")).body.events[0].id, eventId);
        assert.equal((await post(owner, `/${eventId}/apply`)).status, 409);
        assert.equal((await post(owner, `/${eventId}/leave`)).status, 409);
      },
    );
    await t.test(
      "заявки не занимают места, дубликаты запрещены, организатор уведомлён",
      async () => {
        bobApplication = await application(bob);
        carolApplication = await application(carol);
        assert.equal((await post(bob, `/${eventId}/apply`)).status, 409);
        const details = await get(owner, `/${eventId}`);
        assert.equal(details.body.event.participants, 1);
        assert.equal(details.body.applications.length, 2);
        assert.equal((await get(owner, "/notices")).body.unread, 2);
        assert.equal((await get(bob, "/notices")).body.unread, 0);
      },
    );
    await t.test(
      "чужие заявки скрыты, действия организатора недоступны другим",
      async () => {
        const detail = await get(dave, `/${eventId}`);
        assert.equal(detail.status, 200);
        assert.deepEqual(detail.body.applications, []);
        for (const u of [
          detail.body.event.organizer,
          ...detail.body.participants,
        ])
          for (const key of ["email", "phone", "passwordHash", "sessions"])
            assert.ok(!(key in u));
        assert.equal(
          (
            await post(
              dave,
              `/${eventId}/applications/${bobApplication}/accept`,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await post(dave, `/${eventId}/members/${owner.id}/kick`, {
              reason: "Нельзя",
            })
          ).status,
          403,
        );
        assert.equal((await post(dave, `/${eventId}/leave`)).status, 409);
      },
    );
    await t.test(
      "отклонение уведомляет пользователя и не расходует вступления",
      async () => {
        assert.equal(
          (
            await post(
              owner,
              `/${eventId}/applications/${carolApplication}/reject`,
            )
          ).status,
          200,
        );
        assert.equal(
          await db.eventMember.findUnique({
            where: { eventId_userId: { eventId, userId: carol.id } },
          }),
          null,
        );
        const notices = await get(carol, "/notices");
        assert.equal(notices.body.notices[0].kind, "REJECTED");
        carolApplication = await application(carol);
      },
    );
    await t.test(
      "принятие занимает место; полный состав блокирует новые заявки",
      async () => {
        assert.equal((await accept(bobApplication)).status, 200);
        assert.equal((await accept(carolApplication)).status, 200);
        const result = await get(owner, `/${eventId}`);
        assert.equal(result.body.event.free, 0);
        assert.equal(result.body.participants.length, 3);
        assert.equal((await post(dave, `/${eventId}/apply`)).status, 409);
        assert.equal((await accept(bobApplication)).status, 409);
        assert.equal(
          (await get(bob, "/notices")).body.notices[0].kind,
          "ACCEPTED",
        );
      },
    );
    await t.test(
      "первый выход допускает второе вступление, второй запрещает третье",
      async () => {
        assert.equal((await post(bob, `/${eventId}/leave`)).status, 200);
        assert.equal((await post(bob, `/${eventId}/leave`)).status, 409);
        bobApplication = await application(bob);
        assert.equal((await accept(bobApplication)).status, 200);
        let member = await db.eventMember.findUniqueOrThrow({
          where: { eventId_userId: { eventId, userId: bob.id } },
        });
        assert.equal(member.joinCount, 2);
        assert.equal(member.leaveCount, 1);
        assert.equal((await post(bob, `/${eventId}/leave`)).status, 200);
        const third = await post(bob, `/${eventId}/apply`);
        assert.equal(third.status, 409);
        assert.match(third.body.message, /двух вступлений/);
        member = await db.eventMember.findUniqueOrThrow({
          where: { eventId_userId: { eventId, userId: bob.id } },
        });
        assert.equal(member.joinCount, 2);
        assert.equal(member.leaveCount, 2);
      },
    );
    await t.test(
      "исключение требует причину, уведомляет и навсегда запрещает повторную заявку",
      async () => {
        assert.equal(
          (
            await post(owner, `/${eventId}/members/${carol.id}/kick`, {
              reason: "   ",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await post(owner, `/${eventId}/members/${owner.id}/kick`, {
              reason: "Причина",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await post(owner, `/${eventId}/members/${carol.id}/kick`, {
              reason: "Нарушение правил встречи",
            })
          ).status,
          200,
        );
        const denied = await post(carol, `/${eventId}/apply`);
        assert.equal(denied.status, 409);
        assert.match(denied.body.message, /исключения/);
        const own = await get(carol, `/${eventId}`);
        assert.equal(
          own.body.event.member.kickReason,
          "Нарушение правил встречи",
        );
        const other = await get(dave, `/${eventId}`);
        assert.equal(other.body.event.member, null);
        const notices = await get(carol, "/notices");
        assert.equal(notices.body.notices[0].kind, "KICKED");
        assert.match(
          notices.body.notices[0].message,
          /Нарушение правил встречи/,
        );
      },
    );
    await t.test(
      "ограничения вступлений действуют отдельно для каждого мероприятия",
      async () => {
        const second = await post(owner, "", {
          ...input,
          title: "Другая встреча",
          capacity: 4,
        });
        assert.equal(second.status, 201);
        const id = second.body.event.id;
        const bobApp = await application(bob, id),
          carolApp = await application(carol, id);
        assert.equal((await accept(bobApp, id)).status, 200);
        assert.equal((await accept(carolApp, id)).status, 200);
        const cross = await post(
          owner,
          `/${eventId}/applications/${bobApp}/reject`,
        );
        assert.equal(cross.status, 404);
      },
    );
    await t.test(
      "параллельное принятие последнего места допускает ровно одного участника",
      async () => {
        const created = await post(owner, "", {
          ...input,
          title: "Последнее свободное место",
          capacity: 2,
        });
        const id = created.body.event.id;
        const a = await application(bob, id),
          b = await application(carol, id);
        const results = await Promise.all([accept(a, id), accept(b, id)]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        assert.equal(
          await db.eventMember.count({
            where: { eventId: id, state: "ACTIVE" },
          }),
          2,
        );
        assert.equal(
          await db.eventApplication.count({
            where: { eventId: id, status: "PENDING" },
          }),
          1,
        );
        assert.equal(
          await db.eventNotice.count({
            where: { eventId: id, kind: "ACCEPTED" },
          }),
          1,
        );
        const repeated = await Promise.all([accept(a, id), accept(a, id)]);
        assert.ok(repeated.every((r) => r.status === 409));
      },
    );
    await t.test(
      "параллельные повторные заявки создают одну запись и одно уведомление",
      async () => {
        const created = await post(owner, "", {
          ...input,
          title: "Проверка двух заявок",
        });
        const id = created.body.event.id;
        const results = await Promise.all([
          post(dave, `/${id}/apply`),
          post(dave, `/${id}/apply`),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        assert.equal(
          await db.eventApplication.count({ where: { eventId: id } }),
          1,
        );
        assert.equal(
          await db.eventNotice.count({
            where: { eventId: id, kind: "APPLIED" },
          }),
          1,
        );
      },
    );
    await t.test("закрытие: права, CSRF, сохранение состава, уведомления и блокировка действий", async () => {
      const id = (await post(owner, "", { ...input, capacity: 4 })).body.event.id;
      const accepted = await application(bob, id);
      await accept(accepted, id);
      const waiting = await application(carol, id);
      assert.equal((await post(dave, `/${id}/close`)).status, 403);
      assert.equal((await request(app).post(`/api/events/${id}/close`).set("Cookie", `sc_session=${owner.token}`).send({})).status, 403);
      const results = await Promise.all([post(owner, `/${id}/close`), post(owner, `/${id}/close`)]);
      assert.ok(results.every(r => r.status === 200));
      const detail = (await get(owner, `/${id}`)).body;
      assert.ok(detail.event.closedAt);
      assert.equal(detail.participants.length, 2);
      assert.equal(detail.applications.length, 0);
      assert.equal((await get(dave, `/${id}`)).body.event.canApply, false);
      assert.equal((await db.eventApplication.findUniqueOrThrow({ where: { id: waiting } })).status, "REJECTED");
      assert.equal(await db.eventNotice.count({ where: { eventId: id, kind: "CLOSED" } }), 2);
      for (const [a, path, body] of [
        [dave, `/${id}/apply`, {}], [bob, `/${id}/leave`, {}],
        [owner, `/${id}/applications/${waiting}/accept`, {}],
        [owner, `/${id}/members/${bob.id}/kick`, { reason: "Причина" }],
      ] as const) assert.equal((await post(a, path, body)).status, 409);
      assert.ok(!(await get(owner, "?scope=upcoming")).body.events.some((e: {id: string}) => e.id === id));
      assert.ok((await get(owner, "?scope=mine")).body.events.some((e: {id: string}) => e.id === id));
      const past = (await post(owner, "", input)).body.event.id;
      await db.event.update({ where: { id: past }, data: { startsAt: new Date(Date.now() - 1000) } });
      assert.equal((await post(owner, `/${past}/close`)).status, 200);
    });
    await t.test(
      "прошедшее мероприятие закрыто для всех изменений состава",
      async () => {
        await db.event.update({
          where: { id: eventId },
          data: { startsAt: new Date(Date.now() - 1000) },
        });
        for (const [actor, path, body] of [
          [dave, `/${eventId}/apply`, {}],
          [bob, `/${eventId}/leave`, {}],
          [
            owner,
            `/${eventId}/members/${carol.id}/kick`,
            { reason: "Причина" },
          ],
          [owner, `/${eventId}/applications/${bobApplication}/accept`, {}],
        ] as const)
          assert.equal((await post(actor, path, body)).status, 409);
        assert.equal(
          (await get(owner, "?scope=past")).body.events[0].id,
          eventId,
        );
      },
    );
    await t.test(
      "уведомления принадлежат адресату и чтение чужих id ничего не меняет",
      async () => {
        const own = (await get(carol, "/notices")).body;
        assert.ok(own.unread > 0);
        const ids = own.notices.map((n: { id: string }) => n.id);
        assert.equal((await post(dave, "/notices/read", { ids })).status, 200);
        assert.equal((await get(carol, "/notices")).body.unread, own.unread);
        assert.equal((await post(carol, "/notices/read", { ids })).status, 200);
        assert.equal((await get(carol, "/notices")).body.unread, 0);
      },
    );
    await t.test(
      "лента фильтруется, пагинируется и не раскрывает чужие заявки",
      async () => {
        const mine = await get(owner, "?scope=mine");
        assert.ok(mine.body.total >= 4);
        const scoped = await get(dave, "?scope=mine");
        assert.equal(scoped.body.total, 0);
        const search = await get(owner, "?q=Последнее");
        assert.equal(search.body.events.length, 1);
        const wrong = await get(owner, "?category=missing");
        assert.equal(wrong.body.total, 0);
        assert.equal((await get(owner, "?page=0")).status, 400);
        assert.equal((await get(owner, "?scope=secret")).status, 400);
      },
    );
  },
);
