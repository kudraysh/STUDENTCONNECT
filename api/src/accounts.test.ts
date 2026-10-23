import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "./app.js";
import { hashToken } from "./security.js";
import type { VerificationMail } from "./mail.js";

// Изолированный PostgreSQL WASM. Продуктовая БД и DATABASE_URL пользователя не используются.
// Ограничение: один Prisma connection; это не тест конкурентности полноценного PostgreSQL.
test(
  "Этапы 2–3: аккаунты, поиск и миграции через HTTP + Prisma + PostgreSQL WASM",
  { timeout: 120000 },
  async (t) => {
    const pg = await PGlite.create();
    const socket = new PGLiteSocketServer({
      db: pg,
      port: 0,
      host: "127.0.0.1",
    });
    let db: PrismaClient;
    t.after(async () => {
      if (db) await db.$disconnect();
      await socket.stop();
      await pg.close();
    });
    await pg.exec(
      await readFile(
        new URL(
          "../prisma/migrations/20261016180000_init/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await pg.exec(`INSERT INTO "StudyGroup" (id,name,course) VALUES ('old-group','СТ-41',4);
  INSERT INTO "User" (id,email,"passwordHash","firstName","lastName","groupId") VALUES ('old-user','old@example.com','old-hash','Старый','Студент','old-group')`);
    await pg.exec(
      await readFile(
        new URL(
          "../prisma/migrations/20261016200000_accounts/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const name of (
      await readdir(new URL("../prisma/migrations/", import.meta.url))
    )
      .filter((n) => /^\d/.test(n) && n > "20261016200000_accounts")
      .sort()) {
      await pg.exec(
        await readFile(
          new URL(
            `../prisma/migrations/${name}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
    }
    await socket.start();
    db = new PrismaClient({
      datasourceUrl: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1&sslmode=disable`,
    });
    const origin = "http://localhost:5173";
    const mails: VerificationMail[] = [];
    let failMail = false;
    const app = createApp({
      origin,
      checkDatabase: async () => {
        await db.$queryRaw`SELECT 1`;
      },
      accounts: {
        db,
        origin,
        cookie: { production: false, sameSite: "lax" },
        rateLimitMax: 1000,
        mailer: {
          mode: "console",
          async sendVerification(mail) {
            if (failMail) throw new Error("SMTP offline");
            mails.push(mail);
          },
        },
      },
    });
    const category = await db.category.create({ data: { name: "Видеоигры" } });
    const cs2 = await db.interest.create({
      data: { name: "CS2", normalizedName: "cs2", categoryId: category.id },
    });
    const payload = {
      firstName: "Илья",
      lastName: "Иванов",
      group: "ис-21",
      course: 2,
      email: "ILYA@example.com",
      password: "StrongPassword123",
      nickname: "Ilya_dev",
      phone: "+7 900 123-45-67",
      bio: "Баскетбол и код",
      interestIds: [cs2.id],
    };
    const alice = request.agent(app);
    let csrf = "";
    let userId = "";
    let rawCookie = "";
    let token = "";
    const send = (
      agent: ReturnType<typeof request.agent>,
      path: string,
      body: object,
      csrfToken = csrf,
    ) =>
      agent
        .post(path)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send(body);
    const patch = (body: object, csrfToken = csrf) =>
      alice
        .patch("/api/profile")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send(body);
    await t.test(
      "миграция сохраняет курс существующего пользователя",
      async () => {
        const old = await db.user.findUniqueOrThrow({
          where: { id: "old-user" },
        });
        assert.equal(old.course, 4);
      },
    );
    await t.test(
      "регистрация требует интерес, корректную почту и сильный пароль",
      async () => {
        for (const data of [
          { ...payload, interestIds: [] },
          { ...payload, email: "bad" },
          { ...payload, password: "short" },
          { ...payload, password: "123456789012" },
          { ...payload, password: "OnlyLettersPassword" },
          { ...payload, interestIds: ["missing"] },
        ]) {
          const result = await send(alice, "/api/auth/register", data);
          assert.equal(result.status, 400, JSON.stringify(result.body));
        }
        assert.equal(await db.user.count(), 1);
      },
    );
    await t.test("чужой Origin и form POST запрещены", async () => {
      const evil = await alice
        .post("/api/auth/register")
        .set("Origin", "https://evil.example")
        .send(payload);
      assert.equal(evil.status, 403);
      const form = await alice
        .post("/api/auth/login")
        .set("Origin", origin)
        .type("form")
        .send({ email: payload.email, password: payload.password });
      assert.equal(form.status, 403);
    });
    await t.test(
      "регистрация создаёт Argon2id, HttpOnly-cookie и хеши токенов",
      async () => {
        const result = await send(alice, "/api/auth/register", payload);
        assert.equal(result.status, 201, JSON.stringify(result.body));
        csrf = result.body.csrfToken;
        userId = result.body.user.id;
        assert.equal(result.body.user.email, "ilya@example.com");
        assert.equal(result.body.user.nickname, "ilya_dev");
        assert.equal(result.body.user.group, "ИС-21");
        assert.equal(result.body.user.emailVerifiedAt, null);
        assert.ok(!("passwordHash" in result.body.user));
        const cookies = result.headers["set-cookie"] as unknown as string[];
        assert.ok(cookies[0].includes("HttpOnly"));
        assert.ok(cookies[0].includes("SameSite=Lax"));
        rawCookie = cookies[0].split(";")[0].split("=")[1];
        const record = await db.user.findUniqueOrThrow({
          where: { id: userId },
        });
        assert.match(record.passwordHash, /^\$argon2id\$/);
        assert.ok(record.passwordHash !== payload.password);
        assert.ok(
          await db.session.findUnique({
            where: { tokenHash: hashToken(rawCookie) },
          }),
        );
        assert.equal(
          await db.session.findUnique({ where: { tokenHash: rawCookie } }),
          null,
        );
        token = new URL(mails.at(-1)!.url).hash.split("token=")[1];
        assert.ok(
          await db.emailVerification.findUnique({
            where: { tokenHash: hashToken(token) },
          }),
        );
        assert.equal(
          await db.emailVerification.findUnique({
            where: { tokenHash: token },
          }),
          null,
        );
      },
    );
    await t.test(
      "повторная почта и псевдоним запрещены, откат не оставляет группу",
      async () => {
        assert.equal(
          (
            await send(request.agent(app), "/api/auth/register", {
              ...payload,
              email: "ilya@example.com",
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await send(request.agent(app), "/api/auth/register", {
              ...payload,
              email: "other@example.com",
              group: "НО-11",
            })
          ).status,
          409,
        );
        assert.equal(
          await db.studyGroup.findUnique({ where: { name: "НО-11" } }),
          null,
        );
      },
    );
    await t.test(
      "неподтверждённый аккаунт не редактирует профиль и не читает чужие профили",
      async () => {
        assert.equal((await patch(payload)).status, 403);
        assert.equal((await alice.get(`/api/users/${userId}`)).status, 403);
      },
    );
    await t.test("повторное письмо ограничено минутой", async () => {
      assert.equal(
        (await send(alice, "/api/auth/resend-verification", {})).status,
        429,
      );
    });
    await t.test(
      "подтверждение одноразовое; истёкшая ссылка не принимается",
      async () => {
        const expired = "a".repeat(64);
        await db.emailVerification.create({
          data: {
            tokenHash: hashToken(expired),
            userId,
            expiresAt: new Date(Date.now() - 1000),
          },
        });
        assert.equal(
          (await send(alice, "/api/auth/verify-email", { token: expired }))
            .status,
          400,
        );
        assert.equal(
          (await send(alice, "/api/auth/verify-email", { token })).status,
          200,
        );
        assert.equal(
          (await send(alice, "/api/auth/verify-email", { token })).status,
          400,
        );
        assert.ok(
          (await alice.get("/api/auth/session")).body.user.emailVerifiedAt,
        );
      },
    );
    await t.test(
      "CSRF обязателен для профиля, создания интереса и выхода",
      async () => {
        assert.equal((await patch(payload, "")).status, 403);
        assert.equal((await patch(payload, "b".repeat(64))).status, 403);
        assert.equal(
          (
            await send(
              alice,
              "/api/interests",
              { name: "Minecraft", categoryId: category.id },
              "",
            )
          ).status,
          403,
        );
        assert.equal(
          (await send(alice, "/api/auth/logout", {}, "")).status,
          403,
        );
      },
    );
    await t.test(
      "создание интереса объединяет CS2 и Counter-Strike 2, фильтрует запрещённые слова",
      async () => {
        const duplicate = await send(alice, "/api/interests", {
          name: "Counter-Strike 2",
          categoryId: category.id,
        });
        assert.equal(duplicate.status, 200);
        assert.equal(duplicate.body.interest.id, cs2.id);
        const bad = await send(alice, "/api/interests", {
          name: "fuck game",
          categoryId: category.id,
        });
        assert.equal(bad.status, 400);
        const custom = await send(alice, "/api/interests", {
          name: "Minecraft",
          categoryId: category.id,
        });
        assert.equal(custom.status, 201);
        assert.equal(
          (
            await send(alice, "/api/interests", {
              name: "minecraft",
              categoryId: category.id,
            })
          ).status,
          200,
        );
        const found = await alice.get("/api/interests?q=Counter-Strike%202");
        assert.equal(found.body.interests[0].id, cs2.id);
      },
    );
    await t.test(
      "профиль сохраняет поля, интересы и безопасно перекодирует фото",
      async () => {
        const photo = await sharp({
          create: { width: 2, height: 2, channels: 3, background: "#6d5ce7" },
        })
          .png()
          .toBuffer();
        const result = await patch({
          ...payload,
          firstName: "Алексей",
          course: 3,
          avatar: `data:image/png;base64,${photo.toString("base64")}`,
        });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.user.firstName, "Алексей");
        assert.equal(result.body.user.course, 3);
        assert.match(result.body.user.avatar, /^data:image\/webp;base64,/);
        assert.equal(
          (await alice.get("/api/auth/session")).body.user.firstName,
          "Алексей",
        );
        assert.equal(
          (await patch({ ...payload, interestIds: [] })).status,
          400,
        );
        assert.equal(
          (
            await patch({
              ...payload,
              avatar: "data:image/svg+xml;base64,PHN2Zz4=",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await patch({
              ...payload,
              avatar: "data:image/png;base64,bm90YW5pbWFnZQ==",
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "публичный профиль не раскрывает email, телефон, хеши или сессии",
      async () => {
        const result = await alice.get(`/api/users/${userId}`);
        assert.equal(result.status, 200);
        assert.deepEqual(
          Object.keys(result.body.user).sort(),
          [
            "id",
            "firstName",
            "lastName",
            "nickname",
            "bio",
            "avatar",
            "course",
            "group",
            "interests",
          ].sort(),
        );
        const anon = await request(app).get(`/api/users/${userId}`);
        assert.equal(anon.status, 401);
      },
    );
    await t.test("жалоба сохраняется и не дублируется", async () => {
      assert.equal(
        (
          await send(alice, `/api/interests/${cs2.id}/report`, {
            reason: "Неподходящее название интереса",
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await send(alice, `/api/interests/${cs2.id}/report`, {
            reason: "Дополненная причина жалобы",
          })
        ).status,
        201,
      );
      assert.equal(await db.interestReport.count({ where: { userId } }), 1);
    });
    await t.test(
      "выход отзывает сессию; неверный пароль не позволяет войти",
      async () => {
        assert.equal((await send(alice, "/api/auth/logout", {})).status, 200);
        assert.equal(
          await db.session.findUnique({
            where: { tokenHash: hashToken(rawCookie) },
          }),
          null,
        );
        assert.equal((await alice.get("/api/auth/session")).status, 401);
        assert.equal(
          (
            await send(alice, "/api/auth/login", {
              email: payload.email,
              password: "WrongPassword123",
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await send(alice, "/api/auth/login", {
              email: "unknown@example.com",
              password: payload.password,
            })
          ).status,
          401,
        );
        const result = await send(alice, "/api/auth/login", {
          email: payload.email,
          password: payload.password,
        });
        assert.equal(result.status, 200);
        csrf = result.body.csrfToken;
        const cookies = result.headers["set-cookie"] as unknown as string[];
        assert.notEqual(cookies[0].split(";")[0].split("=")[1], rawCookie);
      },
    );
    await t.test(
      "два пользователя имеют изолированные сессии и профили",
      async () => {
        const bob = request.agent(app);
        const registered = await send(bob, "/api/auth/register", {
          ...payload,
          email: "bob@example.com",
          nickname: "bob_dev",
          firstName: "Борис",
        });
        assert.equal(registered.status, 201);
        const bobId = registered.body.user.id;
        const bobCsrf = registered.body.csrfToken;
        const bobToken = new URL(mails.at(-1)!.url).hash.split("token=")[1];
        assert.equal(
          (
            await send(
              bob,
              "/api/auth/verify-email",
              { token: bobToken },
              bobCsrf,
            )
          ).status,
          200,
        );
        assert.equal((await bob.get("/api/auth/session")).body.user.id, bobId);
        assert.equal(
          (await alice.get("/api/auth/session")).body.user.id,
          userId,
        );
        const conflict = await bob
          .patch("/api/profile")
          .set("Origin", origin)
          .set("X-CSRF-Token", bobCsrf)
          .send({ ...payload, email: "bob@example.com" });
        assert.equal(conflict.status, 409);
        const crossCsrf = await send(bob, "/api/auth/logout", {}, csrf);
        assert.equal(crossCsrf.status, 403);
        assert.equal(
          (await bob.get(`/api/users/${userId}`)).body.user.phone,
          undefined,
        );
      },
    );
    await t.test("истёкшая сессия не принимается", async () => {
      const expired = request.agent(app);
      const login = await send(expired, "/api/auth/login", {
        email: payload.email,
        password: payload.password,
      });
      assert.equal(login.status, 200);
      const raw = (login.headers["set-cookie"] as unknown as string[])[0]
        .split(";")[0]
        .split("=")[1];
      await db.session.update({
        where: { tokenHash: hashToken(raw) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      assert.equal((await expired.get("/api/auth/session")).status, 401);
    });
    await t.test(
      "ошибка доставки не удаляет аккаунт; повторная отправка позволяет подтвердить почту",
      async () => {
        failMail = true;
        const carol = request.agent(app);
        const result = await send(carol, "/api/auth/register", {
          ...payload,
          email: "carol@example.com",
          nickname: "carol_dev",
        });
        assert.equal(result.status, 201);
        assert.equal(result.body.delivery.sent, false);
        assert.ok(
          await db.user.findUnique({ where: { email: "carol@example.com" } }),
        );
        failMail = false;
        await db.user.update({
          where: { id: result.body.user.id },
          data: { lastVerificationAt: new Date(Date.now() - 61000) },
        });
        const resend = await send(
          carol,
          "/api/auth/resend-verification",
          {},
          result.body.csrfToken,
        );
        assert.equal(resend.status, 200);
        assert.equal(resend.body.delivery.sent, true);
        const newToken = new URL(mails.at(-1)!.url).hash.split("token=")[1];
        assert.equal(
          (
            await send(
              carol,
              "/api/auth/verify-email",
              { token: newToken },
              result.body.csrfToken,
            )
          ).status,
          200,
        );
      },
    );
    await t.test("лимит попыток входа возвращает 429", async () => {
      const limited = createApp({
        origin,
        checkDatabase: async () => {},
        accounts: {
          db,
          origin,
          cookie: { production: false, sameSite: "lax" },
          rateLimitMax: 1,
          mailer: { mode: "console", async sendVerification() {} },
        },
      });
      assert.equal(
        (
          await request(limited)
            .post("/api/auth/login")
            .set("Origin", origin)
            .send({ email: "none@example.com", password: payload.password })
        ).status,
        401,
      );
      assert.equal(
        (
          await request(limited)
            .post("/api/auth/login")
            .set("Origin", origin)
            .send({ email: "none@example.com", password: payload.password })
        ).status,
        429,
      );
    });
    const sports = await db.category.create({ data: { name: "Спорт" } });
    const coding = await db.category.create({
      data: { name: "Программирование" },
    });
    const basketball = await db.interest.create({
      data: {
        name: "Баскетбол",
        normalizedName: "баскетбол",
        categoryId: sports.id,
      },
    });
    const python = await db.interest.create({
      data: { name: "Python", normalizedName: "python", categoryId: coding.id },
    });
    await db.userInterest.create({
      data: { userId, interestId: basketball.id },
    });
    const fixtureGroup = await db.studyGroup.create({
      data: { name: "ТЕСТ-31", course: 3 },
    });
    async function student(
      nickname: string,
      firstName: string,
      lastName: string,
      ids: string[],
      verified = true,
      groupId = fixtureGroup.id,
    ) {
      return db.user.create({
        data: {
          email: `${nickname}@example.com`,
          nickname,
          firstName,
          lastName,
          passwordHash: "fixture-only-no-login",
          groupId,
          course: 3,
          emailVerifiedAt: verified ? new Date() : null,
          interests: { create: ids.map((interestId) => ({ interestId })) },
        },
      });
    }
    const anna = await student("directory_anna", "Анна", "Яковлева", [
      cs2.id,
      basketball.id,
    ]);
    const boris = await student("directory_boris", "Борис", "Алексеев", [
      basketball.id,
    ]);
    const viktor = await student("directory_viktor", "Виктор", "Белов", [
      python.id,
    ]);
    const pending = await student(
      "directory_pending",
      "Пётр",
      "Неподтверждённый",
      [cs2.id],
      false,
    );
    const empty = await student("directory_empty", "Елена", "Безинтересов", []);
    const universityGroup = await db.studyGroup.create({
      data: { name: "УНИ-11", course: 1, institution: "МИЭТ, университет" },
    });
    const university = await student(
      "directory_uni",
      "Ульяна",
      "Университет",
      [cs2.id],
      true,
      universityGroup.id,
    );
    await t.test(
      "поиск доступен только авторизованным студентам с подтверждённой почтой",
      async () => {
        assert.equal((await request(app).get("/api/people")).status, 401);
        const temporary = request.agent(app);
        const result = await send(temporary, "/api/auth/register", {
          ...payload,
          email: "unverified-search@example.com",
          nickname: "unverified_search",
        });
        assert.equal(result.status, 201);
        assert.equal((await temporary.get("/api/people")).status, 403);
      },
    );
    await t.test(
      "поиск скрывает себя, неподтверждённых, пустые профили и университет",
      async () => {
        const result = await alice.get("/api/people");
        assert.equal(result.status, 200, JSON.stringify(result.body));
        const ids = result.body.users.map((u: { id: string }) => u.id);
        for (const hidden of [userId, pending.id, empty.id, university.id])
          assert.ok(!ids.includes(hidden));
        assert.ok(ids.includes(anna.id));
      },
    );
    await t.test(
      "ранжирование по общим интересам корректно до пагинации",
      async () => {
        const result = await alice.get("/api/people?q=directory_");
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.total, 3);
        assert.deepEqual(
          result.body.users.map((u: { id: string; commonCount: number }) => [
            u.id,
            u.commonCount,
          ]),
          [
            [anna.id, 2],
            [boris.id, 1],
            [viktor.id, 0],
          ],
        );
        assert.equal(result.body.users[0].commonInterests.length, 2);
        const first = await alice.get("/api/people?q=directory_&limit=1");
        const second = await alice.get(
          "/api/people?q=directory_&limit=1&page=2",
        );
        assert.equal(first.body.users[0].id, anna.id);
        assert.equal(second.body.users[0].id, boris.id);
        assert.equal(second.body.total, 3);
        const outside = await alice.get(
          "/api/people?q=directory_&limit=1&page=10",
        );
        assert.equal(outside.body.total, 3);
        assert.deepEqual(outside.body.users, []);
      },
    );
    await t.test(
      "поиск по имени, фамилии и псевдониму не зависит от регистра",
      async () => {
        for (const q of ["АнНа ЯкоВлева", "Яковлева Анна", "@DIRECTORY_ANNA"]) {
          const result = await alice.get("/api/people").query({ q });
          assert.equal(result.status, 200);
          assert.deepEqual(
            result.body.users.map((u: { id: string }) => u.id),
            [anna.id],
          );
        }
      },
    );
    await t.test(
      "фильтры категории, интересов, курса и группы комбинируются",
      async () => {
        const result = await alice.get("/api/people").query({
          q: "directory_",
          category: sports.id,
          interests: basketball.id,
          group: "тест",
          course: 3,
        });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.deepEqual(
          result.body.users.map((u: { id: string }) => u.id),
          [anna.id, boris.id],
        );
        const any = await alice
          .get("/api/people")
          .query({ q: "directory_", interests: `${cs2.id},${python.id}` });
        assert.deepEqual(
          any.body.users.map((u: { id: string }) => u.id),
          [anna.id, viktor.id],
        );
        const none = await alice
          .get("/api/people")
          .query({ q: "directory_", course: 1 });
        assert.equal(none.body.total, 0);
      },
    );
    await t.test(
      "сортировка по фамилии и порядок страниц стабильны",
      async () => {
        const result = await alice.get("/api/people?q=directory_&sort=name");
        assert.deepEqual(
          result.body.users.map((u: { id: string }) => u.id),
          [boris.id, viktor.id, anna.id],
        );
        const repeat = await alice.get("/api/people?q=directory_&sort=name");
        assert.deepEqual(result.body, repeat.body);
      },
    );
    await t.test(
      "каталог не выдаёт приватные поля даже с произвольными query-параметрами",
      async () => {
        const result = await alice.get(
          "/api/people?q=directory_&include=email,passwordHash,phone",
        );
        assert.equal(result.status, 200);
        const allowed = [
          "id",
          "firstName",
          "lastName",
          "nickname",
          "bio",
          "avatar",
          "course",
          "group",
          "interests",
          "commonCount",
          "commonInterests",
        ].sort();
        for (const u of result.body.users)
          assert.deepEqual(Object.keys(u).sort(), allowed);
      },
    );
    await t.test(
      "невалидные фильтры отклоняются, SQL-подобный текст остаётся текстом",
      async () => {
        for (const query of [
          { page: 0 },
          { limit: 1000 },
          { course: 7 },
          { sort: "email" },
          { interests: "x'); DROP TABLE User;--" },
          { q: ["one", "two"] },
        ]) {
          const result = await alice.get("/api/people").query(query);
          assert.equal(result.status, 400, JSON.stringify(result.body));
        }
        const injected = await alice
          .get("/api/people")
          .query({ q: "' OR 1=1 --" });
        assert.equal(injected.status, 200);
        assert.equal(injected.body.total, 0);
        assert.ok(await db.user.count());
      },
    );
    await t.test(
      "поиск требует минимум один интерес, восстановление профиля возвращает доступ",
      async () => {
        await db.userInterest.deleteMany({ where: { userId } });
        const missing = await alice.get("/api/people");
        assert.equal(missing.status, 409);
        assert.equal(missing.body.code, "INTERESTS_REQUIRED");
        await db.userInterest.create({ data: { userId, interestId: cs2.id } });
        assert.equal((await alice.get("/api/people")).status, 200);
      },
    );
  },
);
