import { Router, type RequestHandler, type Response } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { ApiError } from "./errors.js";

export const feedbackInput = z.object({
  clientId: z.string().uuid("Обнови страницу и повтори отправку"),
  area: z.enum(["PEOPLE", "FEED", "EVENTS", "MESSAGES", "PHONE", "PROFILE", "NOTIFICATIONS", "OTHER"]),
  title: z.string().trim().min(5, "Кратко опиши ошибку — от 5 символов").max(120),
  steps: z.string().trim().min(10, "Опиши шаги повторения — от 10 символов").max(2000),
  expected: z.string().trim().min(5, "Напиши, что должно было произойти").max(1000),
  actual: z.string().trim().min(5, "Напиши, что произошло на самом деле").max(2000),
  page: z.string().max(160).regex(/^\/[A-Za-z0-9_/-]*$/, "Укажи только путь страницы без ссылки, токенов и параметров"),
  environment: z.string().trim().max(160).default(""),
}).strict();
const reportSelect = {
  id: true, area: true, title: true, steps: true, expected: true, actual: true,
  page: true, environment: true, status: true, createdAt: true, updatedAt: true,
} satisfies Prisma.FeedbackReportSelect;
export function feedbackRouter({db,csrf}:{db:PrismaClient;csrf:RequestHandler}) {
  const router=Router();
  const actor=(res:Response)=>(res.locals.auth as {user:{id:string}}).user.id;
  router.get("/",async(req,res)=>{
    const page=z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
    const where={userId:actor(res)};
    const [reports,total]=await db.$transaction([
      db.feedbackReport.findMany({where,select:reportSelect,orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(page-1)*10,take:10}),
      db.feedbackReport.count({where}),
    ],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
    res.json({reports,total,page,limit:10});
  });
  const attempts=rateLimit({windowMs:3600000,limit:40,keyGenerator:(_req,res)=>actor(res),
    standardHeaders:"draft-8",legacyHeaders:false,message:{message:"Слишком много попыток отправки. Попробуй позже"}});
  router.post("/",csrf,attempts,async(req,res)=>{
    const input=feedbackInput.parse(req.body), userId=actor(res);
    const result=await db.$transaction(async tx=>{
      // Блокировка аккаунта делает суточный лимит и повтор запроса безопасными между вкладками.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR NO KEY UPDATE`;
      const previous=await tx.feedbackReport.findUnique({where:{userId_clientId:{userId,clientId:input.clientId}}});
      if(previous){
        for(const key of ["area","title","steps","expected","actual","page","environment"] as const)
          if(previous[key]!==input[key])throw new ApiError(409,"Эта отправка уже использована. Обнови форму и повтори");
        return {report:await tx.feedbackReport.findUniqueOrThrow({where:{id:previous.id},select:reportSelect}),created:false};
      }
      const count=await tx.feedbackReport.count({where:{userId,createdAt:{gt:new Date(Date.now()-86400000)}}});
      if(count>=10)throw new ApiError(429,"Можно отправить до 10 отчётов за 24 часа. Попробуй позже");
      const report=await tx.feedbackReport.create({data:{...input,userId},select:reportSelect});
      return {report,created:true};
    },{isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
    res.status(result.created?201:200).json(result);
  });
  return router;
}
