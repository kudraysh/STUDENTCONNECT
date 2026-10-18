import { feedbackRouter } from "./feedback.js";
import { feedRouter } from "./feed.js";
import { notificationRouter } from "./notifications.js";
import { ChatService, chatRouter } from "./chat.js";
import { ApiError } from "./errors.js";
import { eventRouter } from "./events.js";
import { findPeople, peopleQuery, publicSelect } from "./people.js";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { rateLimit } from "express-rate-limit";
import { ZodError } from "zod";
import type { Mailer } from "./mail.js";
import {
  interestSchema,
  isProhibited,
  loginSchema,
  normalizedInterest,
  profileSchema,
  registerSchema,
} from "./validation.js";
import {
  COOKIE,
  checkCsrf,
  cookieOptions,
  csrfFor,
  hashPassword,
  hashToken,
  issueSession,
  newToken,
  verifyPassword,
  type CookieSettings,
} from "./security.js";
export const ownerSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  nickname: true,
  phone: true,
  bio: true,
  avatar: true,
  course: true,
  emailVerifiedAt: true,
  group: { select: { name: true } },
  interests: {
    select: {
      interest: { select: { id: true, name: true, categoryId: true } },
    },
  },
} satisfies Prisma.UserSelect;
type Owner = Prisma.UserGetPayload<{ select: typeof ownerSelect }>;
const ownerDto = (u: Owner) => ({
  ...u,
  group: u.group.name,
  interests: u.interests.map((i) => i.interest),
});
export type AccountsOptions = {
  db: PrismaClient;
  mailer: Mailer;
  origin: string;
  cookie: CookieSettings;
  rateLimitMax?: number;
  chat?: ChatService;
};
export async function avatarData(input: string | null | undefined) {
  if (input == null) return input;
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(input))
    throw new ApiError(400, "Фото: выберите PNG, JPEG или WebP");
  try {
    const buffer = Buffer.from(input.split(",")[1], "base64");
    if (buffer.length > 1000000) throw new Error();
    const output = await sharp(buffer, {
      limitInputPixels: 20000000,
      animated: false,
    })
      .rotate()
      .resize(256, 256, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return `data:image/webp;base64,${output.toString("base64")}`;
  } catch {
    throw new ApiError(
      400,
      "Не удалось прочитать фото. Максимальный размер — 1 МБ",
    );
  }
}
export function accountRouter({
  db,
  mailer,
  origin,
  cookie,
  rateLimitMax,
  chat,
}: AccountsOptions) {
  const router = Router();
  const chatService = chat ?? new ChatService(db);
  const limit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: rateLimitMax ?? 25,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Слишком много попыток. Повторите через 15 минут" },
  });
  const writeLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: rateLimitMax ?? 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Лимит изменений исчерпан. Повторите через час" },
  });
  // Не раскрываем наличие email разницей времени выполнения Argon2.
  const dummyHash = hashPassword(newToken());
  type Auth = { user: Owner; token: string };
  async function authenticate(
    req: Request,
    _res: Response,
    next: NextFunction,
  ) {
    try {
      const token = req.cookies?.[COOKIE];
      if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
        throw new ApiError(401, "Войдите в аккаунт");
      const session = await db.session.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: { select: ownerSelect } },
      });
      if (!session || session.expiresAt <= new Date())
        throw new ApiError(401, "Сессия истекла. Войдите снова");
      (_res.locals as { auth: Auth }).auth = { user: session.user, token };
      next();
    } catch (error) {
      next(error);
    }
  }
  function csrf(req: Request, res: Response, next: NextFunction) {
    if (!checkCsrf(req, (res.locals.auth as Auth).token)) {
      next(new ApiError(403, "Обновите страницу и повторите действие"));
      return;
    }
    next();
  }
  function verified(_req: Request, res: Response, next: NextFunction) {
    if (!(res.locals.auth as Auth).user.emailVerifiedAt) {
      next(new ApiError(403, "Сначала подтвердите электронную почту"));
      return;
    }
    next();
  }
  async function existingInterests(ids: string[]) {
    if (
      (await db.interest.count({ where: { id: { in: ids } } })) !== ids.length
    )
      throw new ApiError(400, "Некоторые интересы не найдены. Обновите список");
  }
  const verificationData = (userId: string) => {
    const token = newToken();
    return {
      token,
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + 86400000),
      },
    };
  };
  async function deliver(email: string, token: string) {
    try {
      await mailer.sendVerification({
        to: email,
        url: `${origin}/verify#token=${token}`,
      });
      return { mode: mailer.mode, sent: true };
    } catch {
      // Не логируем SMTP-объект: он может содержать URL с одноразовым токеном.
      console.error(
        "Не удалось отправить письмо подтверждения. Проверьте настройки почты.",
      );
      return { mode: mailer.mode, sent: false };
    }
  }
  router.get("/catalog", async (_req, res) => {
    const categories = await db.category.findMany({
      orderBy: { name: "asc" },
      include: { interests: { orderBy: { name: "asc" }, take: 300 } },
    });
    res.json({ categories });
  });
  router.get("/interests", async (req, res) => {
    const query = String(req.query.q ?? "").slice(0, 40);
    const normalized = normalizedInterest(query);
    const interests = await db.interest.findMany({
      where: {
        OR: [
          { normalizedName: { contains: normalized } },
          { normalizedName: normalized },
        ],
      },
      take: 20,
      orderBy: { name: "asc" },
    });
    res.json({ interests });
  });
  router.post("/auth/register", limit, async (req, res) => {
    const input = registerSchema.parse(req.body);
    await existingInterests(input.interestIds);
    const avatar = await avatarData(input.avatar);
    const passwordHash = await hashPassword(input.password);
    const token = newToken();
    const user = await db.$transaction(async (tx) => {
      const group = await tx.studyGroup.upsert({
        where: { name: input.group },
        update: {},
        create: { name: input.group, course: input.course },
      });
      return tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          nickname: input.nickname || null,
          phone: input.phone || null,
          bio: input.bio,
          course: input.course,
          avatar,
          groupId: group.id,
          lastVerificationAt: new Date(),
          interests: {
            create: input.interestIds.map((interestId) => ({ interestId })),
          },
          verificationTokens: {
            create: {
              tokenHash: hashToken(token),
              expiresAt: new Date(Date.now() + 86400000),
            },
          },
        },
        select: ownerSelect,
      });
    });
    const csrfToken = await issueSession(
      db,
      user.id,
      req,
      res,
      cookie,
      (hash) => chatService.revoked(hash),
    );
    const delivery = await deliver(user.email, token);
    res.status(201).json({ user: ownerDto(user), csrfToken, delivery });
  });
  router.post("/auth/login", limit, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    const matches = await verifyPassword(
      user?.passwordHash ?? (await dummyHash),
      input.password,
    );
    if (!user || !matches) throw new ApiError(401, "Неверная почта или пароль");
    const csrfToken = await issueSession(
      db,
      user.id,
      req,
      res,
      cookie,
      (hash) => chatService.revoked(hash),
    );
    const owner = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: ownerSelect,
    });
    res.json({ user: ownerDto(owner), csrfToken });
  });
  router.get("/auth/session", authenticate, (_req, res) => {
    const { user, token } = res.locals.auth as Auth;
    res.json({
      user: ownerDto(user),
      csrfToken: csrfFor(token),
      mailMode: mailer.mode,
    });
  });
  router.post("/auth/logout", authenticate, csrf, async (_req, res) => {
    await db.session.deleteMany({
      where: { tokenHash: hashToken((res.locals.auth as Auth).token) },
    });
    chatService.revoked(hashToken((res.locals.auth as Auth).token));
    res.clearCookie(COOKIE, cookieOptions(cookie));
    res.json({ message: "Вы вышли из аккаунта" });
  });
  router.post("/auth/verify-email", limit, async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new ApiError(400, "Некорректная ссылка подтверждения");
    await db.$transaction(async (tx) => {
      const tokenHash = hashToken(token);
      const record = await tx.emailVerification.findUnique({
        where: { tokenHash },
      });
      if (!record || record.expiresAt <= new Date())
        throw new ApiError(
          400,
          "Ссылка истекла или уже использована. Запросите новое письмо",
        );
      // Условное удаление в транзакции гарантирует однократное использование при гонке.
      const deleted = await tx.emailVerification.deleteMany({
        where: { tokenHash, expiresAt: { gt: new Date() } },
      });
      if (deleted.count !== 1)
        throw new ApiError(400, "Ссылка уже использована");
      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      });
      await tx.emailVerification.deleteMany({
        where: { userId: record.userId },
      });
    });
    res.json({ message: "Почта подтверждена. Добро пожаловать!" });
  });
  router.post(
    "/auth/resend-verification",
    authenticate,
    csrf,
    limit,
    async (_req, res) => {
      const { user } = res.locals.auth as Auth;
      if (user.emailVerifiedAt)
        throw new ApiError(400, "Почта уже подтверждена");
      const verification = verificationData(user.id);
      await db.$transaction(async (tx) => {
        const changed = await tx.user.updateMany({
          where: {
            id: user.id,
            OR: [
              { lastVerificationAt: null },
              { lastVerificationAt: { lt: new Date(Date.now() - 60000) } },
            ],
          },
          data: { lastVerificationAt: new Date() },
        });
        if (changed.count !== 1)
          throw new ApiError(
            429,
            "Повторное письмо можно запросить через минуту",
          );
        await tx.emailVerification.deleteMany({
          where: { userId: user.id, expiresAt: { lte: new Date() } },
        });
        await tx.emailVerification.create({ data: verification.data });
      });
      res.json({ delivery: await deliver(user.email, verification.token) });
    },
  );
  router.patch(
    "/profile",
    authenticate,
    verified,
    csrf,
    writeLimit,
    async (req, res) => {
      const input = profileSchema.parse(req.body);
      const { user } = res.locals.auth as Auth;
      await existingInterests(input.interestIds);
      const avatar = await avatarData(input.avatar);
      const result = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id} FOR NO KEY UPDATE`;
        const previous = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          select: { phone: true },
        });
        if (previous.phone !== (input.phone || null)) {
          await tx.phoneAccess.updateMany({
            where: {
              ownerId: user.id,
              status: { in: ["APPROVED", "PENDING"] },
            },
            data: { status: "REVOKED", version: { increment: 1 } },
          });
        }
        const conversations = await tx.conversation.findMany({
          where: { OR: [{ userAId: user.id }, { userBId: user.id }] },
          select: { userAId: true, userBId: true },
        });
        const group = await tx.studyGroup.upsert({
          where: { name: input.group },
          update: {},
          create: { name: input.group, course: input.course },
        });
        await tx.userInterest.deleteMany({ where: { userId: user.id } });
        const updated = await tx.user.update({
          where: { id: user.id },
          data: {
            firstName: input.firstName,
            lastName: input.lastName,
            nickname: input.nickname || null,
            groupId: group.id,
            course: input.course,
            bio: input.bio,
            phone: input.phone || null,
            avatar,
            interests: {
              create: input.interestIds.map((interestId) => ({ interestId })),
            },
          },
          select: ownerSelect,
        });
        return {
          user: updated,
          peers: conversations.map((c) =>
            c.userAId === user.id ? c.userBId : c.userAId,
          ),
        };
      });
      chatService.accessChanged([user.id, ...result.peers]);
      res.json({ user: ownerDto(result.user) });
    },
  );
  router.use("/people/feed", authenticate, verified, feedRouter({ db, csrf }));
  router.get("/people", authenticate, verified, async (req, res) => {
    const { user } = res.locals.auth as Auth;
    const interestIds = user.interests.map((i) => i.interest.id);
    if (!interestIds.length) {
      res.status(409).json({
        message: "Выберите хотя бы один интерес в профиле",
        code: "INTERESTS_REQUIRED",
      });
      return;
    }
    const query = peopleQuery.parse(req.query);
    res.json(await findPeople(db, { id: user.id, interestIds }, query));
  });
  router.get("/users/:id", authenticate, verified, async (req, res) => {
    const user = await db.user.findUnique({
      where: { id: String(req.params.id) },
      select: publicSelect,
    });
    if (!user) throw new ApiError(404, "Студент не найден");
    // Явная выборка: email, телефон, хеш пароля и токены не попадают в публичный ответ.
    res.json({
      user: {
        ...user,
        group: user.group.name,
        interests: user.interests.map((i) => i.interest),
      },
    });
  });
  router.post(
    "/interests",
    authenticate,
    verified,
    csrf,
    writeLimit,
    async (req, res) => {
      const input = interestSchema.parse(req.body);
      if (isProhibited(input.name))
        throw new ApiError(400, "Название содержит запрещённые слова");
      if (!(await db.category.findUnique({ where: { id: input.categoryId } })))
        throw new ApiError(400, "Категория не найдена");
      const normalizedName = normalizedInterest(input.name);
      // upsert + уникальный индекс не позволяют параллельно создать очевидный дубликат.
      const existing = await db.interest.findUnique({
        where: { normalizedName },
      });
      const interest =
        existing ??
        (await db.interest.upsert({
          where: { normalizedName },
          update: {},
          create: {
            name: input.name.normalize("NFKC"),
            normalizedName,
            categoryId: input.categoryId,
          },
        }));
      res.status(existing ? 200 : 201).json({ interest, reused: !!existing });
    },
  );
  router.post(
    "/interests/:id/report",
    authenticate,
    verified,
    csrf,
    writeLimit,
    async (req, res) => {
      const reason =
        typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (reason.length < 10 || reason.length > 500)
        throw new ApiError(400, "Причина жалобы: от 10 до 500 символов");
      const interestId = String(req.params.id);
      if (!(await db.interest.findUnique({ where: { id: interestId } })))
        throw new ApiError(404, "Интерес не найден");
      const userId = (res.locals.auth as Auth).user.id;
      await db.interestReport.upsert({
        where: { userId_interestId: { userId, interestId } },
        update: { reason },
        create: { userId, interestId, reason },
      });
      res.status(201).json({ message: "Жалоба сохранена для рассмотрения" });
    },
  );
  router.use("/feedback", authenticate, verified, feedbackRouter({ db, csrf }));
  router.use("/notifications", authenticate, verified, notificationRouter({ db, csrf }));
  router.use(
    "/events",
    authenticate,
    verified,
    eventRouter({ db, csrf, rateLimitMax }),
  );
  router.use(
    "/chat",
    authenticate,
    verified,
    chatRouter({ service: chatService, csrf, rateLimitMax }),
  );
  return router;
}
export function accountError(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof ApiError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      message: error.issues[0]?.message ?? "Проверьте поля формы",
      fields: error.flatten().fieldErrors,
    });
    return;
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : undefined;
  if (code === "P2002") {
    res.status(409).json({ message: "Почта или псевдоним уже используются" });
    return;
  }
  if (code === "P2003" || code === "P2025") {
    res
      .status(400)
      .json({ message: "Связанная запись не найдена. Обновите страницу" });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ message: "Некорректный JSON" });
    return;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    res
      .status(413)
      .json({ message: "Слишком большой запрос. Фото — не более 1 МБ" });
    return;
  }
  // Не выводим полную Prisma-ошибку: она может содержать параметры запроса.
  console.error(
    "Ошибка API:",
    error instanceof Error ? error.name : "UnknownError",
  );
  res.status(500).json({
    message:
      "Не удалось выполнить запрос. Проверьте подключение к базе и повторите",
  });
}
