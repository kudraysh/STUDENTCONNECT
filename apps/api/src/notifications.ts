import { Router, type RequestHandler } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";

// EventNotice остаётся единственным источником уведомлений мероприятий:
// отметка чтения в любом разделе видна и в общем центре.
export function notificationRouter({ db, csrf }: { db: PrismaClient; csrf: RequestHandler }) {
  const router = Router();
  router.get("/", async (req, res) => {
    const actor = res.locals.auth.user.id as string;
    const query = z.object({
      before: z.coerce.number().int().positive().max(8640000000000000).optional(),
      beforeId: z.string().max(100).optional(),
      unread: z.enum(["0", "1"]).default("0"),
    }).refine(q => !!q.before === !!q.beforeId, "Укажите полный курсор").parse(req.query);
    const result = await db.$transaction(async tx => {
      // UNION ALL сохраняет существующую историю без копирования и дубликатов.
      const rows = await tx.$queryRaw<{id: string; kind: string; message: string; href: string; isRead: boolean; createdAt: Date}[]>(Prisma.sql`
        SELECT * FROM (
          SELECT 'e:' || id AS id, kind, message, '/events/' || "eventId" AS href, "isRead", "createdAt" FROM "EventNotice" WHERE "userId"=${actor}
          UNION ALL
          SELECT 'n:' || id AS id, kind, message, CASE WHEN "profileId" IS NOT NULL THEN '/users/' || "profileId" ELSE '/messages/' || "conversationId" END AS href, "isRead", "createdAt" FROM "Notification" WHERE "userId"=${actor}
        ) AS notices
        WHERE (${query.unread === "0"} OR NOT "isRead")
        /* Prisma хранит timestamp без зоны в UTC; текстовый UTC-курсор не конвертируется через TimeZone БД. */
        ${query.before ? Prisma.sql`AND ("createdAt", id) < (${new Date(query.before).toISOString()}::timestamp, ${query.beforeId}::text)` : Prisma.empty}
        ORDER BY "createdAt" DESC, id DESC LIMIT 31
      `);
      const unread = await tx.eventNotice.count({where:{userId:actor,isRead:false}})
        + await tx.notification.count({where:{userId:actor,isRead:false}});
      const items = rows.slice(0,30), last = items.at(-1);
      return { notifications: items, unread, next: rows.length > 30 && last ? {before:last.createdAt.getTime(),beforeId:last.id} : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    res.json(result);
  });
  router.post("/read", csrf, rateLimit({ windowMs: 60000, limit: 180,
    keyGenerator: (_req,res) => res.locals.auth.user.id,
    standardHeaders: "draft-8", legacyHeaders: false,
  }), async (req,res) => {
    const actor = res.locals.auth.user.id as string;
    const ids = z.array(z.string().regex(/^[en]:[A-Za-z0-9_-]{1,64}$/)).min(1).max(100).parse(req.body?.ids);
    await db.$transaction([
      db.eventNotice.updateMany({where:{userId:actor,id:{in:ids.filter(id=>id.startsWith("e:")).map(id=>id.slice(2))}},data:{isRead:true}}),
      db.notification.updateMany({where:{userId:actor,id:{in:ids.filter(id=>id.startsWith("n:")).map(id=>id.slice(2))}},data:{isRead:true}}),
    ]);
    res.json({ message: "Уведомления прочитаны" });
  });
  return router;
}
