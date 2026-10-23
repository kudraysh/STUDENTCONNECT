import {lockPair,assertUnblocked} from "./safety.js";
import { Router, type RequestHandler, type Response } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { findPeople, peopleQuery } from "./people.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;
export function feedRouter({ db, csrf }: { db: PrismaClient; csrf: RequestHandler }) {
  const router = Router();
  const who = (res: Response) => (res.locals.auth as {user:{id:string}}).user.id;
  const writes = rateLimit({ windowMs: 3600000, limit: 300,
    keyGenerator: (_req,res) => who(res), standardHeaders: "draft-8", legacyHeaders: false,
    message: {message: "Слишком много действий в ленте. Попробуй через час"},
  });
  async function actor(id: string) {
    const user = await db.user.findUniqueOrThrow({where:{id},select:{
      feedTutorialCount:true,group:{select:{institution:true}},interests:{select:{interestId:true}},
    }});
    if (user.group.institution !== "МИЭТ, колледж") throw new ApiError(403,"Лента доступна студентам колледжа");
    if (!user.interests.length) throw new ApiError(409,"Выбери хотя бы один интерес в профиле");
    return user;
  }
  router.get("/", async (_req,res) => {
    const id = who(res), user = await actor(id);
    const result = await findPeople(db,{id,interestIds:user.interests.map(i=>i.interestId)},peopleQuery.parse({limit:1}),true);
    res.json({ person: result.users[0] ?? null, remaining:result.total, tutorialRemaining:2-user.feedTutorialCount });
  });
  router.post("/tutorial/dismiss", csrf, writes, async (_req,res) => {
    const id=who(res);await actor(id);
    await db.user.update({where:{id},data:{feedTutorialCount:2}});
    res.json({tutorialRemaining:0});
  });
  router.post("/:id", csrf, writes, async (req,res) => {
    const id=who(res), targetId=z.string().min(1).max(64).parse(req.params.id);
    const {decision}=z.object({decision:z.enum(["LIKE","SKIP"])}).parse(req.body);
    if (targetId===id) throw new ApiError(400,"Нельзя выбрать себя");
    await actor(id);
    const result=await db.$transaction(async tx=>{
      // Общая блокировка действий аккаунта: несколько вкладок не отправят повторный интерес.
      // NO KEY UPDATE совместим с FK-проверкой адресата при встречных свайпах.
      await lockPair(tx,id,targetId);
      await assertUnblocked(tx,id,targetId);
      const target=await tx.user.findFirst({where:{id:targetId,emailVerifiedAt:{not:null},group:{institution:"МИЭТ, колледж"},interests:{some:{}}},select:{id:true}});
      if (!target) throw new ApiError(404,"Студент недоступен в ленте");
      const user=await tx.user.findUniqueOrThrow({where:{id},select:{feedTutorialCount:true,firstName:true,lastName:true}});
      const previous=await tx.feedChoice.findUnique({where:{actorId_targetId:{actorId:id,targetId}}});
      if (previous && (previous.decision === "LIKE" || (previous.hiddenUntil && previous.hiddenUntil > new Date())))
        return {decision:previous.decision,created:false,tutorialRemaining:2-user.feedTutorialCount,hiddenUntil:previous.hiddenUntil};
      const hiddenUntil=decision==="SKIP" ? new Date(Date.now()+WEEK) : null;
      await tx.feedChoice.upsert({where:{actorId_targetId:{actorId:id,targetId}},
        create:{actorId:id,targetId,decision,hiddenUntil},update:{decision,hiddenUntil}});
      if (decision==="LIKE") await tx.notification.create({data:{
        userId:targetId,profileId:id,kind:"PERSON_INTEREST",
        message:`Твоим профилем интересуется ${user.firstName} ${user.lastName}. Познакомитесь?`,
      }});
      const count=Math.min(2,user.feedTutorialCount+1);
      await tx.user.update({where:{id},data:{feedTutorialCount:count}});
      return {decision,created:true,tutorialRemaining:2-count,hiddenUntil};
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
    res.json(result);
  });
  return router;
}
