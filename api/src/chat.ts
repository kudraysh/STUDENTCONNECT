import {lockPair,assertUnblocked} from "./safety.js";
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
  editedAt:true,deletedAt:true,replyToId:true,
  hiddenFor:{select:{userId:true}},
  replyTo:{select:{id:true,senderId:true,text:true,deletedAt:true,hiddenFor:{select:{userId:true}}}},
} satisfies Prisma.ChatMessageSelect;
type SelectedMessage = Prisma.ChatMessageGetPayload<{select:typeof messageSelect}>;
function messageDto(m:SelectedMessage,actor:string){
 const {hiddenFor,replyTo,...safe}=m;
 const hidden=hiddenFor.some(h=>h.userId===actor);
 const replyHidden=replyTo?.hiddenFor.some(h=>h.userId===actor);
 return {...safe,hiddenForMe:hidden,text:hidden?"":m.text,
   replyTo:!hidden&&replyTo?{id:replyTo.id,senderId:replyTo.senderId,unavailable:!!replyTo.deletedAt||!!replyHidden,text:replyTo.deletedAt||replyHidden?"Сообщение недоступно":replyTo.text}:null};
}
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
  replyToId:z.number().int().positive().max(2147483647).optional(),
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
    const c=await this.db.$transaction(async tx=>{
      await lockPair(tx,actor,peer);await assertUnblocked(tx,actor,peer);
      return tx.conversation.upsert({where:{userAId_userBId:{userAId,userBId}},create:{userAId,userBId},update:{}});
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
                where:{deletedAt:null,hiddenFor:{none:{userId:actor}}},
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
              deletedAt:null,hiddenFor:{none:{userId:actor}},
              id: { gt: c.userAId === actor ? c.readA : c.readB },
            },
          });
          conversations.push({
            id: c.id,
            peer: { ...peer, group: peer.group.name },
            lastMessage: c.messages[0] ? messageDto(c.messages[0],actor) : null,
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
   WHERE m."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "MessageHidden" h WHERE h."messageId"=m.id AND h."userId"=${actor}) AND m."senderId"<>${actor} AND ((c."userAId"=${actor} AND m.id>c."readA") OR (c."userBId"=${actor} AND m.id>c."readB"))`;
    const phoneRequests = await this.db.phoneAccess.count({
      where: { ownerId: actor, status: "PENDING" },
    });
    return { unread: result[0].count, phoneRequests };
  }
  async history(
    actor: string,
    id: string,
    query: { before?: number; after?: number; ids?:number[] },
  ) {
    return this.db.$transaction(
      async (tx) => {
        await this.conversation(tx, id, actor);
        const after = query.after !== undefined;
        const rows = await tx.chatMessage.findMany({
          where: {
            conversationId: id,
            ...(query.ids ? {id:{in:query.ids}} : {}),
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
        return { messages:messages.map(m=>messageDto(m,actor)), hasMore };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async send(actor: string, id: string, input: z.infer<typeof messageInput>) {
    const result = await this.db.$transaction(
      async (tx) => {
        // Сериализация отправок в одном диалоге даёт порядок id/commit и безопасные read-курсоры.
        const pair=await this.conversation(tx,id,actor);
        await lockPair(tx,actor,peerId(pair,actor));await assertUnblocked(tx,actor,peerId(pair,actor));
        await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id=${id} FOR UPDATE`;
        const c = await this.conversation(tx, id, actor);
        const previous = await tx.chatMessage.findUnique({
          where: {
            senderId_clientId: { senderId: actor, clientId: input.clientId },
          },
          select: messageSelect,
        });
        if (previous) {
          if (previous.conversationId !== id || previous.text !== input.text || previous.replyToId !== (input.replyToId??null) || previous.deletedAt !== null)
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
        if(input.replyToId){
          const reply=await tx.chatMessage.findFirst({where:{id:input.replyToId,conversationId:id,deletedAt:null,hiddenFor:{none:{userId:actor}}},select:{id:true}});
          if(!reply)throw new ApiError(400,"Сообщение для ответа недоступно в этом диалоге");
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
      for(const recipient of result.peers)this.emit("message", { users: [recipient], message: messageDto(result.message,recipient) });
      this.changed(result.peers);
    }
    return { message: messageDto(result.message,actor) };
  }
  async changeMessage(actor:string,id:string,messageId:number,action:"edit"|"self"|"everyone",text?:string){
    const users=await this.db.$transaction(async tx=>{
      const c=await this.conversation(tx,id,actor);
      await lockPair(tx,actor,peerId(c,actor));
      await tx.$queryRaw`SELECT id FROM "Conversation" WHERE id=${id} FOR UPDATE`;
      const m=await tx.chatMessage.findFirst({where:{id:messageId,conversationId:id},select:messageSelect});
      if(!m)throw new ApiError(404,"Сообщение не найдено");
      if(action==="self"){
        await tx.messageHidden.upsert({where:{messageId_userId:{messageId,userId:actor}},create:{messageId,userId:actor},update:{}});
        await tx.notification.updateMany({where:{userId:actor,messageId},data:{isRead:true}});
        return [actor];
      }
      if(m.senderId!==actor)throw new ApiError(403,"Можно изменять только свои сообщения");
      if(action==="edit"){
        await assertUnblocked(tx,actor,peerId(c,actor));
        if(m.deletedAt||m.hiddenFor.some(h=>h.userId===actor))throw new ApiError(409,"Сообщение уже удалено");
        await tx.chatMessage.update({where:{id:messageId},data:{text:text!,editedAt:new Date()}});
      }else{
        await tx.chatMessage.updateMany({where:{id:messageId,deletedAt:null},data:{text:"",deletedAt:new Date()}});
        await tx.notification.updateMany({where:{messageId,kind:"MESSAGE"},data:{isRead:true}});
      }
      return [actor,peerId(c,actor)];
    });this.changed(users);return {message:"Изменения сохранены"};
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
        const blocks=await tx.userBlock.findMany({where:{OR:[{blockerId:actor,blockedId:peer},{blockerId:peer,blockedId:actor}]}});
        const unavailable=blocks.length>0;
        const { phone, ...safe } = other;
        return {
          id,
          peer: { ...safe, group: safe.group.name, hasPhone: !!phone },
          blockedByMe:blocks.some(b=>b.blockerId===actor),unavailable,
          hasOwnPhone: !!own.phone,
          outgoing,
          incoming,
          phone: !unavailable && outgoing?.status === "APPROVED" && phone ? phone : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async requestPhone(actor: string, id: string) {
    const result = await this.db.$transaction(async (tx) => {
      const c = await this.conversation(tx, id, actor),
        ownerId = peerId(c, actor);
      await lockPair(tx,actor,ownerId);await assertUnblocked(tx,actor,ownerId);
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

      let access = await tx.phoneAccess.findUnique({
        where: { id: accessId },
      });
      if (!access || access.ownerId !== actor)
        throw new ApiError(404, "Запрос не найден");
      await lockPair(tx,actor,access.requesterId);
      if(decision!=="revoke")await assertUnblocked(tx,actor,access.requesterId);
      access=await tx.phoneAccess.findUniqueOrThrow({where:{id:accessId}});
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
        ids:z.string().max(1500).transform(v=>v.split(",").map(x=>cursor.parse(x))).refine(v=>v.length<=100).optional(),
        before: cursor.optional(),
        after: z.coerce.number().int().min(0).max(2147483647).optional(),
      })
      .refine(
        (v) => [v.before,v.after,v.ids].filter(x=>x!==undefined).length<=1,
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
  router.patch("/conversations/:id/messages/:messageId",async(req,res)=>{
    const {text}=z.object({text:messageInput.shape.text}).strict().parse(req.body);
    res.json(await service.changeMessage(actor(res),String(req.params.id),cursor.parse(req.params.messageId),"edit",text));
  });
  router.delete("/conversations/:id/messages/:messageId",async(req,res)=>{
    const {scope}=z.object({scope:z.enum(["self","everyone"])}).strict().parse(req.body);
    res.json(await service.changeMessage(actor(res),String(req.params.id),cursor.parse(req.params.messageId),scope));
  });
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
