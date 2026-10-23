import { EventEmitter } from "node:events";
import { Router, type RequestHandler, type Response } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { ApiError } from "./errors.js";
const COLLEGE = "МИЭТ, колледж";
const person = {
  id: true,
  firstName: true,
  lastName: true,
  nickname: true,
  avatar: true,
  group: { select: { name: true } },
  course: true,
} satisfies Prisma.UserSelect;
const messageSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  text: true,
  createdAt: true,
  clientId: true,
} satisfies Prisma.ChatMessageSelect;
const accessSelect = {
  id: true,
  status: true,
  version: true,
  requestedAt: true,
  updatedAt: true,
} satisfies Prisma.PhoneAccessSelect;
const cursor = z.coerce.number().int().positive().max(2147483647);
export const messageInput = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Введите сообщение")
    .max(4000, "Не более 4000 символов"),
  clientId: z.string().uuid("Некорректный идентификатор отправки"),
});
type Store = PrismaClient | Prisma.TransactionClient;
function peerId(c: { userAId: string; userBId: string }, actor: string) {
  return c.userAId === actor ? c.userBId : c.userAId;
}
export class ChatService extends EventEmitter {
  constructor(public db: PrismaClient) {
    super();
  }
  changed(ids: string[]) {
    this.emit("changed", [...new Set(ids)]);
  }
  accessChanged(ids: string[]) {
    this.emit("access", [...new Set(ids)]);
    this.changed(ids);
  }
  revoked(hash: string) {
    this.emit("sessionRevoked", hash);
  }
  async eligible(db: Store, actor: string) {
    const user = await db.user.findUnique({
      where: { id: actor },
      select: {
        emailVerifiedAt: true,
        group: { select: { institution: true } },
      },
    });
    if (!user?.emailVerifiedAt || user.group.institution !== COLLEGE)
      throw new ApiError(
        403,
        "Чат доступен студентам колледжа с подтверждённой почтой",
      );
  }
  async conversation(db: Store, id: string, actor: string) {
    const c = await db.conversation.findUnique({ where: { id } });
    if (!c || (c.userAId !== actor && c.userBId !== actor))
      throw new ApiError(404, "Диалог не найден");
    await this.eligible(db, actor);
    await this.eligible(db, peerId(c, actor));
    return c;
  }
  async start(actor: string, peer: string) {
    if (actor === peer) throw new ApiError(400, "Выберите другого студента");
    await this.eligible(this.db, actor);
    await this.eligible(this.db, peer);
    const [userAId, userBId] = [actor, peer].sort();
    const c = await this.db.conversation
      .upsert({
        where: { userAId_userBId: { userAId, userBId } },
        update: {},
        create: { userAId, userBId },
      })
      .catch(async (error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          return this.db.conversation.findUniqueOrThrow({
            where: { userAId_userBId: { userAId, userBId } },
          });
        }
        throw error;
      });
    this.changed([actor, peer]);
    return { id: c.id };
  }
  async list(actor: string, page: number) {
    await this.eligible(this.db, actor);
    return this.db.$transaction(
      async (tx) => {
        const where = { OR: [{ userAId: actor }, { userBId: actor }] };
        const [rows, total] = await Promise.all([
          tx.conversation.findMany({
            where,
            orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
            skip: (page - 1) * 30,
            take: 30,
            include: {
              userA: { select: person },
              userB: { select: person },
              messages: {
                select: messageSelect,
                orderBy: { id: "desc" },
                take: 1,
              },
            },
          }),
          tx.conversation.count({ where }),
        ]);
        const requests = await tx.phoneAccess.findMany({
          where: {
            ownerId: actor,
            status: "PENDING",
            requesterId: { in: rows.map((c) => peerId(c, actor)) },
          },
          select: { requesterId: true },
        });
        const pendingPhones = new Set(requests.map((r) => r.requesterId));
        const conversations = [];
        for (const c of rows) {
          const peer = c.userAId === actor ? c.userB : c.userA;
          const unread = await tx.chatMessage.count({
            where: {
              conversationId: c.id,
              senderId: { not: actor },
              id: { gt: c.userAId === actor ? c.readA : c.readB },
            },
          });
          conversations.push({
            id: c.id,
            peer: { ...peer, group: peer.group.name },
            lastMessage: c.messages[0] ?? null,
            unread,
            phoneRequest: pendingPhones.has(peer.id),
            lastMessageAt: c.lastMessageAt,
          });
        }
        return { conversations, total, page, limit: 30 };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async unread(actor: string) {
    await this.eligible(this.db, actor);
    const result = await this.db.$queryRaw<{ count: number }[]>`
   SELECT count(*)::int AS count FROM "ChatMessage" m JOIN "Conversation" c ON c.id=m."conversationId"
   WHERE m."senderId"<>${actor} AND ((c."userAId"=${actor} AND m.id>c."readA") OR (c."userBId"=${actor} AND m.id>c."readB"))`;
    const phoneRequests = await this.db.phoneAccess.count({
      where: { ownerId: actor, status: "PENDING" },
    });
    return { unread: result[0].count, phoneRequests };
  }
  async history(
    actor: string,
    id: string,
    query: { before?: number; after?: number },
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.conversation(tx, id, actor);
        const after = query.after !== undefined;
        const rows = await tx.chatMessage.findMany({
          where: {
            conversationId: id,
            ...(query.before
              ? { id: { lt: query.before } }
              : after
                ? { id: { gt: query.after } }
                : {}),
          },
          orderBy: { id: after ? "asc" : "desc" },
          take: 101,
          select: messageSelect,
        });
        const hasMore = rows.length > 100,
          messages = rows.slice(0, 100);
        if (!after) messages.reverse();
        return { messages, hasMore };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async send(actor: string, id: string, input: z.infer<typeof messageInput>) {
    const result = await this.db.$transaction(
      async (tx) => {
        // Сериализация отправок в одном диалоге даёт порядок id/commit и безопасные read-курсоры.
        await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id=${id} FOR UPDATE`;
        const c = await this.conversation(tx, id, actor);
        const previous = await tx.chatMessage.findUnique({
          where: {
            senderId_clientId: { senderId: actor, clientId: input.clientId },
          },
          select: messageSelect,
        });
        if (previous) {
          if (previous.conversationId !== id || previous.text !== input.text)
            throw new ApiError(
              409,
              "Эта отправка уже использована для другого сообщения",
            );
          return {
            message: previous,
            peers: [actor, peerId(c, actor)],
            created: false,
          };
        }
        const message = await tx.chatMessage.create({
          data: { conversationId: id, senderId: actor, ...input },
          select: messageSelect,
        });
        await tx.notification.create({ data: {
          userId: peerId(c, actor), kind: "MESSAGE", message: "Новое личное сообщение",
          conversationId: id, messageId: message.id,
        } });
        await tx.conversation.update({
          where: { id },
          data: { lastMessageAt: message.createdAt },
        });
        return { message, peers: [actor, peerId(c, actor)], created: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    if (result.created) {
      this.emit("message", { users: result.peers, message: result.message });
      this.changed(result.peers);
    }
    return { message: result.message };
  }
  async read(actor: string, id: string, messageId: number) {
    await this.db.$transaction(async (tx) => {
      const c = await this.conversation(tx, id, actor);
      const message = await tx.chatMessage.findFirst({
        where: { id: messageId, conversationId: id },
        select: { id: true },
      });
      if (!message) throw new ApiError(400, "Сообщение не принадлежит диалогу");
      await tx.notification.updateMany({
        where: { userId: actor, conversationId: id, kind: "MESSAGE", messageId: { lte: messageId }, isRead: false },
        data: { isRead: true },
      });
      const ownA = c.userAId === actor;
      await tx.conversation.updateMany({
        where: {
          id,
          ...(ownA
            ? { readA: { lt: messageId } }
            : { readB: { lt: messageId } }),
        },
        data: ownA ? { readA: messageId } : { readB: messageId },
      });
    });
    this.changed([actor]);
    return { message: "Сообщения отмечены прочитанными" };
  }
  async details(actor: string, id: string) {
    return this.db.$transaction(
      async (tx) => {
        const c = await this.conversation(tx, id, actor),
          peer = peerId(c, actor);
        const [other, own, outgoing, incoming] = await Promise.all([
          tx.user.findUniqueOrThrow({
            where: { id: peer },
            select: { ...person, phone: true },
          }),
          tx.user.findUniqueOrThrow({
            where: { id: actor },
            select: { phone: true },
          }),
          tx.phoneAccess.findUnique({
            where: {
              ownerId_requesterId: { ownerId: peer, requesterId: actor },
            },
            select: accessSelect,
          }),
          tx.phoneAccess.findUnique({
            where: {
              ownerId_requesterId: { ownerId: actor, requesterId: peer },
            },
            select: accessSelect,
          }),
        ]);
        const { phone, ...safe } = other;
        return {
          id,
          peer: { ...safe, group: safe.group.name, hasPhone: !!phone },
          hasOwnPhone: !!own.phone,
          outgoing,
          incoming,
          phone: outgoing?.status === "APPROVED" && phone ? phone : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async requestPhone(actor: string, id: string) {
    const result = await this.db.$transaction(async (tx) => {
      const c = await this.conversation(tx, id, actor),
        ownerId = peerId(c, actor);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ownerId} FOR NO KEY UPDATE`;
      const owner = await tx.user.findUniqueOrThrow({
        where: { id: ownerId },
        select: { phone: true },
      });
      if (!owner.phone)
        throw new ApiError(409, "Пользователь не указал номер телефона");
      const previous = await tx.phoneAccess.findUnique({
        where: { ownerId_requesterId: { ownerId, requesterId: actor } },
      });
      if (previous?.status === "PENDING")
        throw new ApiError(409, "Запрос уже ожидает решения");
      if (previous?.status === "APPROVED")
        throw new ApiError(409, "Доступ к номеру уже разрешён");
      if (previous && Date.now() - previous.updatedAt.getTime() < 60000)
        throw new ApiError(429, "Повторный запрос доступен через минуту");
      const access = await tx.phoneAccess.upsert({
        where: { ownerId_requesterId: { ownerId, requesterId: actor } },
        update: {
          status: "PENDING",
          version: { increment: 1 },
          requestedAt: new Date(),
        },
        create: { ownerId, requesterId: actor },
        select: accessSelect,
      });
      await tx.notification.create({ data: {
        userId: ownerId, kind: "PHONE_REQUEST", message: "Собеседник запросил доступ к твоему номеру телефона",
        conversationId: id,
      } });
      return { access, users: [actor, ownerId] };
    });
    this.accessChanged(result.users);
    return { access: result.access };
  }
  async decidePhone(
    actor: string,
    accessId: string,
    decision: "approve" | "reject" | "revoke",
    version: number,
  ) {
    const result = await this.db.$transaction(async (tx) => {
      await this.eligible(tx, actor);
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor} FOR NO KEY UPDATE`;
      const access = await tx.phoneAccess.findUnique({
        where: { id: accessId },
      });
      if (!access || access.ownerId !== actor)
        throw new ApiError(404, "Запрос не найден");
      await this.eligible(tx, access.requesterId);
      if (access.version !== version)
        throw new ApiError(409, "Запрос изменился. Обновите диалог");
      if (
        decision === "revoke"
          ? !["APPROVED", "PENDING"].includes(access.status)
          : access.status !== "PENDING"
      )
        throw new ApiError(409, "Это действие уже недоступно");
      const owner = await tx.user.findUniqueOrThrow({
        where: { id: actor },
        select: { phone: true },
      });
      if (decision === "approve" && !owner.phone)
        throw new ApiError(409, "Сначала укажите телефон в профиле");
      const updated = await tx.phoneAccess.update({
        where: { id: accessId },
        data: {
          status:
            decision === "approve"
              ? "APPROVED"
              : decision === "reject"
                ? "REJECTED"
                : "REVOKED",
          version: { increment: 1 },
        },
        select: accessSelect,
      });
      const conversation = await tx.conversation.findUnique({ where: {
        userAId_userBId: { userAId: [actor, access.requesterId].sort()[0], userBId: [actor, access.requesterId].sort()[1] },
      } });
      if (conversation) await tx.notification.create({ data: {
        userId: access.requesterId,
        kind: decision === "approve" ? "PHONE_APPROVED" : decision === "reject" ? "PHONE_REJECTED" : "PHONE_REVOKED",
        message: decision === "approve" ? "Собеседник разрешил посмотреть свой номер" : decision === "reject" ? "Запрос номера отклонён" : "Доступ к номеру отозван",
        conversationId: conversation.id,
      } });
      return { access: updated, users: [actor, access.requesterId] };
    });
    this.accessChanged(result.users);
    return { access: result.access };
  }
}
export function chatRouter({
  service,
  csrf,
  rateLimitMax,
}: {
  service: ChatService;
  csrf: RequestHandler;
  rateLimitMax?: number;
}) {
  const router = Router();
  const actor = (res: Response) =>
    (res.locals.auth as { user: { id: string } }).user.id;
  const writes = rateLimit({
    windowMs: 60000,
    limit: rateLimitMax ?? 180,
    keyGenerator: (_req, res) => actor(res),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Слишком много действий. Повторите через минуту" },
  });
  router.use((req, res, next) =>
    ["GET", "HEAD", "OPTIONS"].includes(req.method)
      ? next()
      : csrf(req, res, next),
  );
  router.use((req, res, next) =>
    ["GET", "HEAD", "OPTIONS"].includes(req.method)
      ? next()
      : writes(req, res, next),
  );
  router.get("/unread", async (_req, res) =>
    res.json(await service.unread(actor(res))),
  );
  router.get("/conversations", async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .default(1)
      .parse(req.query.page);
    res.json(await service.list(actor(res), page));
  });
  router.post("/conversations", async (req, res) => {
    const peer = z.string().min(1).max(64).parse(req.body?.peerId);
    res.status(201).json(await service.start(actor(res), peer));
  });
  router.get("/conversations/:id", async (req, res) =>
    res.json(await service.details(actor(res), String(req.params.id))),
  );
  router.get("/conversations/:id/messages", async (req, res) => {
    const query = z
      .object({
        before: cursor.optional(),
        after: z.coerce.number().int().min(0).max(2147483647).optional(),
      })
      .refine(
        (v) => !(v.before !== undefined && v.after !== undefined),
        "Укажите один курсор истории",
      )
      .parse(req.query);
    res.json(await service.history(actor(res), String(req.params.id), query));
  });
  const messageLimit = rateLimit({
    windowMs: 60000,
    limit: rateLimitMax ?? 60,
    keyGenerator: (_req, res) => actor(res),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Слишком много сообщений. Повторите через минуту" },
  });
  router.post("/conversations/:id/messages", messageLimit, async (req, res) =>
    res
      .status(201)
      .json(
        await service.send(
          actor(res),
          String(req.params.id),
          messageInput.parse(req.body),
        ),
      ),
  );
  router.post("/conversations/:id/read", async (req, res) =>
    res.json(
      await service.read(
        actor(res),
        String(req.params.id),
        cursor.parse(req.body?.messageId),
      ),
    ),
  );
  router.post("/conversations/:id/phone", async (req, res) =>
    res
      .status(201)
      .json(await service.requestPhone(actor(res), String(req.params.id))),
  );
  router.post("/phone/:id/:decision", async (req, res) =>
    res.json(
      await service.decidePhone(
        actor(res),
        String(req.params.id),
        z.enum(["approve", "reject", "revoke"]).parse(req.params.decision),
        z.number().int().positive().parse(req.body?.version),
      ),
    ),
  );
  return router;
}
