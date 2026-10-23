import { Router, type RequestHandler, type Response } from "express";
import {
  Prisma,
  type PrismaClient,
  type EventMember,
  type EventApplication,
} from "@prisma/client";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { ApiError } from "./errors.js";
const COLLEGE = "МИЭТ, колледж";
const person = {
  id: true,
  firstName: true,
  lastName: true,
  nickname: true,
  avatar: true,
  course: true,
  group: { select: { name: true } },
} satisfies Prisma.UserSelect;
const userId = (res: Response) =>
  (res.locals.auth as { user: { id: string } }).user.id;
export const eventInput = z.object({
  title: z.string().trim().min(5, "Название — от 5 символов").max(100),
  description: z.string().trim().min(10, "Описание — от 10 символов").max(2000),
  place: z.string().trim().min(3, "Укажите место проведения").max(200),
  categoryId: z.string().min(1, "Выберите категорию").max(64),
  startsAt: z
    .string()
    .datetime({ offset: true, message: "Некорректная дата и время" })
    .refine(
      (v) => new Date(v).getTime() > Date.now(),
      "Выберите дату в будущем",
    ),
  capacity: z.coerce
    .number()
    .int()
    .min(2, "Минимум 2 участника, включая организатора")
    .max(200),
});
const listQuery = z.object({
  q: z.string().trim().max(80).default(""),
  category: z.string().max(64).default(""),
  scope: z
    .enum(["upcoming", "mine", "participating", "past"])
    .default("upcoming"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});
export function applyBlock(
  member: Pick<EventMember, "state" | "joinCount" | "leaveCount"> | null,
  app: Pick<EventApplication, "status"> | null,
  organizer: boolean,
  future: boolean,
  free: number,
) {
  if (organizer) return "Вы организатор этого мероприятия";
  if (!future) return "Мероприятие уже началось";
  if (member?.state === "KICKED")
    return "После исключения повторное вступление запрещено";
  if (member?.state === "ACTIVE") return "Вы уже участвуете";
  if ((member?.joinCount ?? 0) >= 2 || (member?.leaveCount ?? 0) >= 2)
    return "Лимит двух вступлений исчерпан";
  if (app?.status === "PENDING") return "Заявка ожидает решения организатора";
  if (free <= 0) return "Свободных мест нет";
  return null;
}
function includes(actor: string) {
  return {
    organizer: { select: person },
    category: { select: { id: true, name: true } },
    _count: {
      select: {
        members: { where: { state: "ACTIVE" } },
        applications: { where: { status: "PENDING" } },
      },
    },
    members: {
      where: { userId: actor },
      select: {
        state: true,
        joinCount: true,
        leaveCount: true,
        kickReason: true,
      },
    },
    applications: { where: { userId: actor }, select: { status: true } },
  } satisfies Prisma.EventInclude;
}
type Row = Prisma.EventGetPayload<{ include: ReturnType<typeof includes> }>;
function dto(row: Row, actor: string) {
  const { members, applications, _count, ...rest } = row;
  const member = members[0] ?? null,
    application = applications[0] ?? null;
  const free = Math.max(0, row.capacity - _count.members),
    isOrganizer = row.organizerId === actor;
  const block = row.closedAt ? "Мероприятие закрыто организатором" : applyBlock(
    member,
    application,
    isOrganizer,
    row.startsAt.getTime() > Date.now(),
    free,
  );
  return {
    ...rest,
    organizer: { ...row.organizer, group: row.organizer.group.name },
    participants: _count.members,
    free,
    pendingCount: isOrganizer ? _count.applications : 0,
    isOrganizer,
    member,
    application,
    canApply: block === null,
    applyBlock: block,
  };
}
export function eventRouter({
  db,
  csrf,
  rateLimitMax,
}: {
  db: PrismaClient;
  csrf: RequestHandler;
  rateLimitMax?: number;
}) {
  const router = Router();
  const writeLimit = rateLimit({
    windowMs: 3600000,
    limit: rateLimitMax ?? 120,
    keyGenerator: (_req, res) => userId(res),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      message: "Слишком много действий с мероприятиями. Повторите через час",
    },
  });
  router.use(async (_req, res, next) => {
    try {
      const actor = await db.user.findUnique({
        where: { id: userId(res) },
        select: { group: { select: { institution: true } } },
      });
      if (actor?.group.institution !== COLLEGE)
        throw new ApiError(403, "Мероприятия пока доступны студентам колледжа");
      next();
    } catch (error) {
      next(error);
    }
  });
  router.use((req, res, next) =>
    ["GET", "HEAD", "OPTIONS"].includes(req.method)
      ? next()
      : csrf(req, res, next),
  );
  router.use((req, res, next) =>
    ["GET", "HEAD", "OPTIONS"].includes(req.method)
      ? next()
      : writeLimit(req, res, next),
  );
  router.get("/notices", async (_req, res) => {
    const actor = userId(res);
    const [notices, unread] = await db.$transaction([
      db.eventNotice.findMany({
        where: { userId: actor },
        orderBy: [{ isRead: "asc" }, { createdAt: "desc" }, { id: "desc" }],
        take: 30,
        select: {
          id: true,
          eventId: true,
          kind: true,
          message: true,
          isRead: true,
          createdAt: true,
        },
      }),
      db.eventNotice.count({ where: { userId: actor, isRead: false } }),
    ]);
    res.json({ notices, unread });
  });
  router.post("/notices/read", async (req, res) => {
    const ids = z
      .array(z.string().min(1).max(64))
      .max(100)
      .parse(req.body?.ids);
    await db.eventNotice.updateMany({
      where: { id: { in: ids }, userId: userId(res) },
      data: { isRead: true },
    });
    res.json({ message: "Уведомления отмечены прочитанными" });
  });
  router.get("/", async (req, res) => {
    const query = listQuery.parse(req.query),
      actor = userId(res),
      now = new Date();
    const where: Prisma.EventWhereInput = {
      organizer: { group: { institution: COLLEGE } },
      ...(query.category ? { categoryId: query.category } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { description: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(query.scope === "upcoming"
        ? { startsAt: { gt: now }, closedAt: null }
        : query.scope === "past"
          ? { startsAt: { lte: now } }
          : query.scope === "mine"
            ? { organizerId: actor }
            : { members: { some: { userId: actor, state: "ACTIVE" } } }),
    };
    const [rows, total] = await db.$transaction(
      [
        db.event.findMany({
          where,
          include: includes(actor),
          orderBy: [
            { startsAt: query.scope === "past" ? "desc" : "asc" },
            { id: "asc" },
          ],
          skip: (query.page - 1) * 12,
          take: 12,
        }),
        db.event.count({ where }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    res.json({
      events: rows.map((row) => dto(row, actor)),
      total,
      page: query.page,
      limit: 12,
    });
  });
  router.post("/", async (req, res) => {
    const input = eventInput.parse(req.body),
      actor = userId(res);
    if (!(await db.category.findUnique({ where: { id: input.categoryId } })))
      throw new ApiError(400, "Категория не найдена");
    const event = await db.event.create({
      data: {
        ...input,
        startsAt: new Date(input.startsAt),
        organizerId: actor,
        members: { create: { userId: actor } },
      },
      include: includes(actor),
    });
    res.status(201).json({ event: dto(event, actor) });
  });
  router.get("/:id", async (req, res) => {
    const actor = userId(res),
      id = String(req.params.id);
    const result = await db.$transaction(
      async (tx) => {
        const row = await tx.event.findFirst({
          where: { id, organizer: { group: { institution: COLLEGE } } },
          include: includes(actor),
        });
        if (!row) throw new ApiError(404, "Мероприятие не найдено");
        const participants = await tx.eventMember.findMany({
          where: { eventId: id, state: "ACTIVE" },
          orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
          select: { user: { select: person } },
        });
        const applications =
          row.organizerId === actor
            ? await tx.eventApplication.findMany({
                where: { eventId: id, status: "PENDING" },
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                select: { id: true, createdAt: true, user: { select: person } },
              })
            : [];
        return {
          event: dto(row, actor),
          participants: participants.map((m) => ({
            ...m.user,
            group: m.user.group.name,
          })),
          applications: applications.map((a) => ({
            ...a,
            user: { ...a.user, group: a.user.group.name },
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    res.json(result);
  });
  async function locked<T>(
    id: string,
    action: (
      tx: Prisma.TransactionClient,
      event: Prisma.EventGetPayload<{
        include: {
          organizer: { select: { group: { select: { institution: true } } } };
        };
      }>,
    ) => Promise<T>,
    closing = false,
  ) {
    return db.$transaction(
      async (tx) => {
        // Один и тот же ряд блокируется при КАЖДОМ изменении состава.
        // В PostgreSQL конкурентное принятие последнего места ждёт завершения этой транзакции.
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM "Event" WHERE id=${id} FOR UPDATE`;
        if (!rows.length) throw new ApiError(404, "Мероприятие не найдено");
        const event = await tx.event.findUniqueOrThrow({
          where: { id },
          include: {
            organizer: { select: { group: { select: { institution: true } } } },
          },
        });
        if (event.organizer.group.institution !== COLLEGE)
          throw new ApiError(404, "Мероприятие не найдено");
        if (event.closedAt && !closing)
          throw new ApiError(409, "Мероприятие закрыто организатором");
        if (event.startsAt.getTime() <= Date.now() && !closing)
          throw new ApiError(
            409,
            "Мероприятие уже началось, изменения закрыты",
          );
        return action(tx, event);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 10000,
        timeout: 10000,
      },
    );
  }
  router.post("/:id/close", async (req, res) => {
    const id = String(req.params.id), actor = userId(res);
    await locked(id, async (tx, event) => {
      if (event.organizerId !== actor)
        throw new ApiError(403, "Закрыть мероприятие может только организатор");
      if (event.closedAt) return;
      const members = await tx.eventMember.findMany({
        where: { eventId: id, state: "ACTIVE" }, select: { userId: true },
      });
      const applicants = await tx.eventApplication.findMany({
        where: { eventId: id, status: "PENDING" }, select: { userId: true },
      });
      await tx.event.update({ where: { id }, data: { closedAt: new Date() } });
      await tx.eventApplication.updateMany({
        where: { eventId: id, status: "PENDING" }, data: { status: "REJECTED" },
      });
      const recipients = [...new Set([...members, ...applicants].map(u => u.userId))]
        .filter(user => user !== actor);
      if (recipients.length) await tx.eventNotice.createMany({ data: recipients.map(user => ({
        eventId: id, userId: user, kind: "CLOSED",
        message: `Организатор закрыл мероприятие «${event.title}». Новые заявки и изменение состава недоступны.`,
      })) });
    }, true);
    res.json({ message: "Мероприятие закрыто" });
  });
  router.post("/:id/apply", async (req, res) => {
    const id = String(req.params.id),
      actor = userId(res);
    await locked(id, async (tx, event) => {
      const member = await tx.eventMember.findUnique({
        where: { eventId_userId: { eventId: id, userId: actor } },
      });
      const app = await tx.eventApplication.findUnique({
        where: { eventId_userId: { eventId: id, userId: actor } },
      });
      const count = await tx.eventMember.count({
        where: { eventId: id, state: "ACTIVE" },
      });
      const block = applyBlock(
        member,
        app,
        event.organizerId === actor,
        true,
        event.capacity - count,
      );
      if (block) throw new ApiError(409, block);
      await tx.eventApplication.upsert({
        where: { eventId_userId: { eventId: id, userId: actor } },
        update: { status: "PENDING", createdAt: new Date() },
        create: { eventId: id, userId: actor },
      });
      await tx.eventNotice.create({
        data: {
          eventId: id,
          userId: event.organizerId,
          kind: "APPLIED",
          message: `Новая заявка на «${event.title}». Откройте мероприятие для рассмотрения.`,
        },
      });
    });
    res.status(201).json({ message: "Заявка отправлена организатору" });
  });
  router.post(
    "/:id/applications/:applicationId/:decision",
    async (req, res) => {
      const id = String(req.params.id),
        actor = userId(res),
        applicationId = String(req.params.applicationId);
      const decision = z.enum(["accept", "reject"]).parse(req.params.decision);
      await locked(id, async (tx, event) => {
        if (event.organizerId !== actor)
          throw new ApiError(
            403,
            "Только организатор может рассматривать заявки",
          );
        const app = await tx.eventApplication.findUnique({
          where: { id: applicationId },
          include: { user: { select: { emailVerifiedAt: true } } },
        });
        if (!app || app.eventId !== id)
          throw new ApiError(404, "Заявка не найдена");
        if (app.status !== "PENDING")
          throw new ApiError(409, "Эта заявка уже рассмотрена");
        if (decision === "accept") {
          if (!app.user.emailVerifiedAt)
            throw new ApiError(409, "Участник не подтвердил почту");
          const member = await tx.eventMember.findUnique({
            where: { eventId_userId: { eventId: id, userId: app.userId } },
          });
          const count = await tx.eventMember.count({
            where: { eventId: id, state: "ACTIVE" },
          });
          const block = applyBlock(
            member,
            null,
            false,
            true,
            event.capacity - count,
          );
          if (block) throw new ApiError(409, block);
          await tx.eventMember.upsert({
            where: { eventId_userId: { eventId: id, userId: app.userId } },
            update: {
              state: "ACTIVE",
              joinCount: { increment: 1 },
              joinedAt: new Date(),
            },
            create: { eventId: id, userId: app.userId },
          });
        }
        await tx.eventApplication.update({
          where: { id: applicationId },
          data: { status: decision === "accept" ? "ACCEPTED" : "REJECTED" },
        });
        await tx.eventNotice.create({
          data: {
            eventId: id,
            userId: app.userId,
            kind: decision === "accept" ? "ACCEPTED" : "REJECTED",
            message: `Заявка на «${event.title}» ${decision === "accept" ? "принята. Вы стали участником." : "отклонена организатором."}`,
          },
        });
      });
      res.json({
        message: decision === "accept" ? "Участник принят" : "Заявка отклонена",
      });
    },
  );
  router.post("/:id/leave", async (req, res) => {
    const id = String(req.params.id),
      actor = userId(res);
    await locked(id, async (tx, event) => {
      if (event.organizerId === actor)
        throw new ApiError(
          409,
          "Организатор не может выйти из своего мероприятия",
        );
      const member = await tx.eventMember.findUnique({
        where: { eventId_userId: { eventId: id, userId: actor } },
      });
      if (member?.state !== "ACTIVE")
        throw new ApiError(409, "Вы не являетесь участником");
      await tx.eventMember.update({
        where: { eventId_userId: { eventId: id, userId: actor } },
        data: { state: "LEFT", leaveCount: { increment: 1 } },
      });
      await tx.eventNotice.create({
        data: {
          eventId: id,
          userId: event.organizerId,
          kind: "LEFT",
          message: `Участник вышел из «${event.title}». Освободилось место.`,
        },
      });
    });
    res.json({ message: "Вы вышли из мероприятия" });
  });
  router.post("/:id/members/:memberId/kick", async (req, res) => {
    const id = String(req.params.id),
      actor = userId(res),
      memberId = String(req.params.memberId);
    const reason = z
      .string()
      .trim()
      .min(1, "Укажите причину исключения")
      .max(500)
      .parse(req.body?.reason);
    await locked(id, async (tx, event) => {
      if (event.organizerId !== actor)
        throw new ApiError(403, "Исключить участника может только организатор");
      if (memberId === actor)
        throw new ApiError(409, "Нельзя исключить организатора");
      const member = await tx.eventMember.findUnique({
        where: { eventId_userId: { eventId: id, userId: memberId } },
      });
      if (member?.state !== "ACTIVE")
        throw new ApiError(409, "Участник не найден в составе мероприятия");
      await tx.eventMember.update({
        where: { eventId_userId: { eventId: id, userId: memberId } },
        data: { state: "KICKED", kickReason: reason },
      });
      await tx.eventApplication.updateMany({
        where: { eventId: id, userId: memberId },
        data: { status: "KICKED" },
      });
      await tx.eventNotice.create({
        data: {
          eventId: id,
          userId: memberId,
          kind: "KICKED",
          message: `Вы исключены из «${event.title}». Причина: ${reason}. Повторное вступление в это мероприятие невозможно.`,
        },
      });
    });
    res.json({ message: "Участник исключён и уведомлён" });
  });
  return router;
}
