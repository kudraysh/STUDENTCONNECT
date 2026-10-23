import { Router, type RequestHandler, type Response } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { ApiError } from "./errors.js";
import type { ChatService } from "./chat.js";
type Store=PrismaClient|Prisma.TransactionClient;
export async function lockPair(db:Store,a:string,b:string){
  // Единый порядок блокировок для блокирования, отправки, свайпов и доступа к номеру.
  await db.$queryRaw`SELECT id FROM "User" WHERE id IN (${a},${b}) ORDER BY id FOR NO KEY UPDATE`;
}
export async function assertUnblocked(db:Store,a:string,b:string){
  if(await db.userBlock.findFirst({where:{OR:[{blockerId:a,blockedId:b},{blockerId:b,blockedId:a}]},select:{blockerId:true}}))
    throw new ApiError(403,"Общение недоступно: между вами установлена блокировка");
}
const reportInput=z.object({kind:z.enum(["USER","MESSAGE","EVENT"]),targetId:z.string().min(1).max(64),reason:z.enum(["AVATAR","PROFILE","ABUSE","SPAM","DANGER","OTHER"]),details:z.string().trim().max(2000).default(""),clientId:z.string().uuid()}).strict();
export function safetyRouter({db,csrf,chat}:{db:PrismaClient;csrf:RequestHandler;chat:ChatService}){
 const r=Router();const actor=(res:Response)=>(res.locals.auth as {user:{id:string}}).user.id;
 const writes=rateLimit({windowMs:60000,limit:30,keyGenerator:(_q,s)=>actor(s),standardHeaders:"draft-8",legacyHeaders:false,message:{message:"Слишком много действий. Повтори через минуту"}});
 r.use((q,s,n)=>["GET","HEAD","OPTIONS"].includes(q.method)?n():csrf(q,s,n));
 r.use((q,s,n)=>["GET","HEAD","OPTIONS"].includes(q.method)?n():writes(q,s,n));
 r.get("/blocks",async(_q,s)=>{const blocks=await db.userBlock.findMany({where:{blockerId:actor(s)},orderBy:{createdAt:"desc"},take:500,select:{blockedId:true,createdAt:true,blocked:{select:{firstName:true,lastName:true}}}});s.json({blocks});});
 r.get("/blocks/:id",async(q,s)=>{const id=z.string().min(1).max(64).parse(q.params.id),a=actor(s);const [own,other]=await Promise.all([db.userBlock.findUnique({where:{blockerId_blockedId:{blockerId:a,blockedId:id}}}),db.userBlock.findUnique({where:{blockerId_blockedId:{blockerId:id,blockedId:a}}})]);s.json({blockedByMe:!!own,unavailable:!!own||!!other});});
 r.post("/blocks/:id",async(q,s)=>{
  const a=actor(s),b=z.string().min(1).max(64).parse(q.params.id);
  if(a===b)throw new ApiError(400,"Нельзя заблокировать себя");
  await db.$transaction(async tx=>{await lockPair(tx,a,b);
   if(!await tx.user.findUnique({where:{id:b},select:{id:true}}))throw new ApiError(404,"Пользователь не найден");
   await tx.userBlock.upsert({where:{blockerId_blockedId:{blockerId:a,blockedId:b}},create:{blockerId:a,blockedId:b},update:{}});
   await tx.phoneAccess.updateMany({where:{OR:[{ownerId:a,requesterId:b},{ownerId:b,requesterId:a}]},data:{status:"REVOKED",version:{increment:1}}});
  });chat.accessChanged([a,b]);s.json({blockedByMe:true,unavailable:true});
 });
 r.delete("/blocks/:id",async(q,s)=>{const a=actor(s),b=z.string().min(1).max(64).parse(q.params.id);await db.$transaction(async tx=>{await lockPair(tx,a,b);await tx.userBlock.deleteMany({where:{blockerId:a,blockedId:b}});});chat.accessChanged([a,b]);s.json({message:"Блокировка снята. Доступ к телефону автоматически не восстанавливается"});});
 r.post("/reports",async(q,s)=>{
  const input=reportInput.parse(q.body),a=actor(s);
  const result=await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${a} FOR NO KEY UPDATE`;
   const old=await tx.safetyReport.findUnique({where:{reporterId_clientId:{reporterId:a,clientId:input.clientId}}});
   if(old){if(old.kind!==input.kind||old.targetId!==input.targetId||old.reason!==input.reason||old.details!==input.details)throw new ApiError(409,"Эта отправка уже использована");return {id:old.id};}
   if(await tx.safetyReport.count({where:{reporterId:a,createdAt:{gte:new Date(Date.now()-86400000)}}})>=10)throw new ApiError(429,"Не более 10 жалоб за 24 часа");
   let snapshot:Prisma.InputJsonValue;
   if(input.kind==="USER"){
    if(input.targetId===a)throw new ApiError(400,"Нельзя пожаловаться на себя");
    const u=await tx.user.findUnique({where:{id:input.targetId},select:{id:true,firstName:true,lastName:true,nickname:true,bio:true,avatar:true}});
    if(!u)throw new ApiError(404,"Профиль не найден");snapshot=u;
   }else if(input.kind==="EVENT"){
    const e=await tx.event.findUnique({where:{id:input.targetId},select:{id:true,title:true,description:true,place:true,organizerId:true}});
    if(!e)throw new ApiError(404,"Мероприятие не найдено");if(e.organizerId===a)throw new ApiError(400,"Нельзя пожаловаться на своё мероприятие");snapshot=e;
   }else{
    if(!/^[1-9][0-9]{0,9}$/.test(input.targetId)||Number(input.targetId)>2147483647)throw new ApiError(400,"Некорректное сообщение");
    const m=await tx.chatMessage.findFirst({where:{id:Number(input.targetId),conversation:{OR:[{userAId:a},{userBId:a}]},hiddenFor:{none:{userId:a}}},select:{id:true,text:true,senderId:true,conversationId:true,deletedAt:true,editedAt:true}});
    if(!m||m.deletedAt)throw new ApiError(404,"Сообщение недоступно");if(m.senderId===a)throw new ApiError(400,"Нельзя пожаловаться на своё сообщение");
    snapshot={id:m.id,text:m.text,senderId:m.senderId,conversationId:m.conversationId,editedAt:m.editedAt?.toISOString()??null};
   }
   return tx.safetyReport.create({data:{...input,reporterId:a,snapshot},select:{id:true}});
  });s.status(201).json({...result,message:"Жалоба сохранена для ручного рассмотрения. При необходимости заблокируй пользователя."});
 });return r;
}
