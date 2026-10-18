import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
// Выборка общая для списка и публичного профиля: приватных полей здесь нет.
export const publicSelect = {
  id: true,
  firstName: true,
  lastName: true,
  nickname: true,
  bio: true,
  avatar: true,
  course: true,
  group: { select: { name: true } },
  interests: {
    select: {
      interest: { select: { id: true, name: true, categoryId: true } },
    },
  },
} satisfies Prisma.UserSelect;
export const peopleQuery = z.object({
  q: z.string().trim().max(60).default(""),
  group: z.string().trim().max(24).default(""),
  course: z.coerce.number().int().min(1).max(6).optional(),
  category: z.string().max(64).default(""),
  interests: z
    .string()
    .max(1300)
    .default("")
    .transform((v) => [...new Set(v.split(",").filter(Boolean))])
    .refine(
      (v) => v.length <= 20 && v.every((id) => /^[a-z0-9_-]{1,64}$/i.test(id)),
      "Некорректный список интересов",
    ),
  sort: z.enum(["matches", "name"]).default("matches"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(24).default(12),
});
export async function findPeople(
  db: PrismaClient,
  actor: { id: string; interestIds: string[] },
  query: z.infer<typeof peopleQuery>,
  feed = false,
) {
  const conditions = [
    Prisma.sql`u.id <> ${actor.id}`,
    Prisma.sql`u."emailVerifiedAt" IS NOT NULL`,
    Prisma.sql`g.institution = ${"МИЭТ, колледж"}`,
    Prisma.sql`EXISTS (SELECT 1 FROM "UserInterest" ui WHERE ui."userId" = u.id)`,
  ];
  if (feed) conditions.push(Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "FeedChoice" fc WHERE fc."actorId"=${actor.id} AND fc."targetId"=u.id
    AND (fc.decision='LIKE' OR fc."hiddenUntil" > ${new Date().toISOString()}::timestamp)
  )`);
  const q = query.q.replace(/^@/, "").toLocaleLowerCase("ru");
  if (q)
    conditions.push(
      Prisma.sql`strpos(lower(u."firstName" || ' ' || u."lastName" || ' ' || u."firstName" || ' ' || COALESCE(u.nickname, '')), ${q}) > 0`,
    );
  if (query.group)
    conditions.push(
      Prisma.sql`strpos(lower(g.name), ${query.group.toLocaleLowerCase("ru")}) > 0`,
    );
  if (query.course) conditions.push(Prisma.sql`u.course = ${query.course}`);
  if (query.category)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "UserInterest" ui JOIN "Interest" i ON i.id=ui."interestId" WHERE ui."userId"=u.id AND i."categoryId"=${query.category})`,
    );
  if (query.interests.length)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "UserInterest" ui WHERE ui."userId"=u.id AND ui."interestId" IN (${Prisma.join(query.interests)}))`,
    );
  const order =
    query.sort === "name"
      ? Prisma.sql`"lastName", "firstName", id`
      : Prisma.sql`"commonCount" DESC, "lastName", "firstName", id`;
  // Ранжирование выполняется в БД ДО пагинации. Все пользовательские значения — параметры SQL.
  // Один снимок запроса даёт согласованные total и страницу; весь каталог в память не загружается.
  return db.$transaction(
    async (tx) => {
      const result = await tx.$queryRaw<
        { total: number; rows: { id: string; commonCount: number }[] }[]
      >(Prisma.sql`
   WITH candidates AS (
    SELECT u.id, u."firstName", u."lastName", count(shared."interestId")::int AS "commonCount"
    FROM "User" u JOIN "StudyGroup" g ON g.id=u."groupId"
    LEFT JOIN "UserInterest" shared ON shared."userId"=u.id AND shared."interestId" IN (${Prisma.join(actor.interestIds)})
    WHERE ${Prisma.join(conditions, " AND ")} GROUP BY u.id
   )
   SELECT (SELECT count(*)::int FROM candidates) AS total,
    COALESCE((SELECT json_agg(p) FROM (SELECT id, "commonCount" FROM candidates ORDER BY ${order} LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}) p), '[]'::json) AS rows
  `);
      const ranked = result[0];
      const users = await tx.user.findMany({
        where: { id: { in: ranked.rows.map((row) => row.id) } },
        select: publicSelect,
      });
      const byId = new Map(users.map((user) => [user.id, user]));
      return {
        total: ranked.total,
        page: query.page,
        limit: query.limit,
        users: ranked.rows.flatMap((row) => {
          const user = byId.get(row.id);
          if (!user) return [];
          const interests = user.interests
            .map((i) => i.interest)
            .sort((a, b) => a.name.localeCompare(b.name, "ru"));
          return [
            {
              ...user,
              group: user.group.name,
              interests,
              commonCount: row.commonCount,
              commonInterests: interests.filter((i) =>
                actor.interestIds.includes(i.id),
              ),
            },
          ];
        }),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
