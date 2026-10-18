import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { createApp } from "./app.js";
import { ChatService } from "./chat.js";
import { newToken, hashToken, csrfFor } from "./security.js";

test("Этап 6: общий центр уведомлений", {timeout:120000}, async t => {
  const pg = await PGlite.create();
  for (const name of (await readdir(new URL("../prisma/migrations/",import.meta.url))).filter(n=>/^\d/.test(n)).sort())
    await pg.exec(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),"utf8"));
  const socket = new PGLiteSocketServer({db:pg,port:0,host:"127.0.0.1"}); await socket.start();
  const db = new PrismaClient({datasourceUrl:`postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1&sslmode=disable`});
  t.after(async()=>{await db.$disconnect();await socket.stop();await pg.close();});
  const origin="http://localhost:5173", chat=new ChatService(db);
  const app=createApp({origin,checkDatabase:async()=>{},accounts:{db,chat,origin,cookie:{production:false,sameSite:"lax"},rateLimitMax:1000,mailer:{mode:"console",async sendVerification(){}}}});
  const group=await db.studyGroup.create({data:{name:"ИС-21",course:2}});
  const category=await db.category.create({data:{name:"Спорт"}});
  async function actor(name:string,verified=true){
    const u=await db.user.create({data:{firstName:name,lastName:"Студент",email:`${randomUUID()}@test.invalid`,passwordHash:"fixture",groupId:group.id,emailVerifiedAt:verified?new Date():null,phone:"+79000000001"}});
    const token=newToken();await db.session.create({data:{userId:u.id,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+3600000)}});
    return {id:u.id,token,csrf:csrfFor(token)};
  }
  const a=await actor("Алиса"), b=await actor("Борис"), c=await actor("Карина"), pending=await actor("Без подтверждения",false);
  type Actor=typeof a;
  const get=(u:Actor,path="")=>request(app).get(`/api/notifications${path}`).set("Cookie",`sc_session=${u.token}`).timeout({response:5000,deadline:10000});
  const post=(u:Actor,path:string,body:object={})=>request(app).post(`/api${path}`).set("Cookie",`sc_session=${u.token}`).set("Origin",origin).set("X-CSRF-Token",u.csrf).send(body);
  const conversation=(await chat.start(a.id,b.id)).id;
  let msgId=0, eventId="";
  await t.test("авторизация и подтверждение обязательны",async()=>{
    assert.equal((await request(app).get("/api/notifications")).status,401);
    assert.equal((await get(pending)).status,403);
    assert.equal((await get(c)).body.unread,0);
  });
  await t.test("сообщение создаёт ровно одно уведомление получателю без текста и телефона",async()=>{
    const clientId=randomUUID();
    const result=await chat.send(a.id,conversation,{text:"секретный текст",clientId});msgId=result.message.id;
    await chat.send(a.id,conversation,{text:"секретный текст",clientId});
    const r=await get(b);assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(r.body.unread,1);assert.equal(r.body.notifications.length,1);
    assert.equal(r.body.notifications[0].href,`/messages/${conversation}`);
    assert.equal(r.body.notifications[0].kind,"MESSAGE");
    assert.ok(!JSON.stringify(r.body).includes("секретный текст"));assert.ok(!JSON.stringify(r.body).includes("79000000001"));
    assert.equal((await get(a)).body.unread,0);assert.equal((await get(c)).body.unread,0);
  });
  await t.test("чтение чужих id запрещено по владельцу, CSRF обязателен",async()=>{
    const ids=(await get(b)).body.notifications.map((n:{id:string})=>n.id);
    assert.equal((await request(app).post("/api/notifications/read").set("Cookie",`sc_session=${b.token}`).send({ids})).status,403);
    assert.equal((await post(c,"/notifications/read",{ids})).status,200);
    assert.equal((await get(b)).body.unread,1);
    assert.equal((await post(b,"/notifications/read",{ids:["bad"]})).status,400);
    assert.equal((await post(b,"/notifications/read",{ids:[]})).status,400);
  });
  await t.test("чтение чата синхронизируется с колокольчиком, чтение уведомления не читает сообщения",async()=>{
    await chat.read(b.id,conversation,msgId);assert.equal((await get(b)).body.unread,0);
    await chat.send(a.id,conversation,{text:"Второе",clientId:randomUUID()});
    const ids=(await get(b)).body.notifications.filter((n:{isRead:boolean})=>!n.isRead).map((n:{id:string})=>n.id);
    await post(b,"/notifications/read",{ids});assert.equal((await get(b)).body.unread,0);
    assert.equal((await chat.unread(b.id)).unread,1);
  });
  await t.test("запрос, разрешение, отзыв и отказ по телефону сохраняются без номера",async()=>{
    const r=await chat.requestPhone(a.id,conversation);
    assert.ok((await get(b)).body.notifications.some((n:{kind:string})=>n.kind==="PHONE_REQUEST"));
    const approval=await chat.decidePhone(b.id,r.access.id,"approve",r.access.version);
    assert.ok((await get(a)).body.notifications.some((n:{kind:string})=>n.kind==="PHONE_APPROVED"));
    await chat.decidePhone(b.id,r.access.id,"revoke",approval.access.version);
    await db.phoneAccess.update({where:{id:r.access.id},data:{updatedAt:new Date(Date.now()-61000)}});
    const second=await chat.requestPhone(a.id,conversation);
    await chat.decidePhone(b.id,r.access.id,"reject",second.access.version);
    const result=(await get(a)).body;
    assert.ok(result.notifications.some((n:{kind:string})=>n.kind==="PHONE_REVOKED"));
    assert.ok(result.notifications.some((n:{kind:string})=>n.kind==="PHONE_REJECTED"));
    assert.ok(!JSON.stringify(result).includes("79000000001"));
  });
  await t.test("мероприятия используют общую историю и общую отметку чтения",async()=>{
    const result=await post(a,"/events",{title:"Встреча студентов",description:"Играем в баскетбол вместе",place:"Спортзал",categoryId:category.id,capacity:3,startsAt:new Date(Date.now()+86400000).toISOString()});
    eventId=result.body.event.id;
    await post(b,`/events/${eventId}/apply`);
    const notices=(await get(a)).body.notifications;
    const event=notices.find((n:{kind:string})=>n.kind==="APPLIED");assert.ok(event);assert.equal(event.href,`/events/${eventId}`);
    await post(a,"/notifications/read",{ids:[event.id]});
    assert.equal((await db.eventNotice.findUniqueOrThrow({where:{id:event.id.slice(2)}})).isRead,true);
    const application=await db.eventApplication.findFirstOrThrow({where:{eventId,userId:b.id}});
    await post(a,`/events/${eventId}/applications/${application.id}/accept`);
    const accepted=(await get(b)).body.notifications.find((n:{kind:string})=>n.kind==="ACCEPTED");assert.ok(accepted);
    await post(b,"/events/notices/read",{ids:[accepted.id.slice(2)]});
    assert.equal((await get(b)).body.notifications.find((n:{id:string})=>n.id===accepted.id).isRead,true);
    await post(a,`/events/${eventId}/close`);
    assert.ok((await get(b)).body.notifications.some((n:{kind:string})=>n.kind==="CLOSED"));
  });
  await t.test("курсорная пагинация при одинаковых датах и новом уведомлении не теряет записи",async()=>{
    await db.$executeRawUnsafe("SET TIME ZONE 'Europe/Moscow'");
    const createdAt=new Date("2026-01-01T00:00:00.000Z");
    await db.notification.createMany({data:Array.from({length:65},(_,i)=>({id:`fixture-${String(i).padStart(3,"0")}`,userId:c.id,kind:"MESSAGE",message:"Новое сообщение",conversationId:conversation,createdAt}))});
    const first=(await get(c)).body;assert.equal(first.notifications.length,30);assert.equal(first.unread,65);
    await db.notification.create({data:{userId:c.id,kind:"MESSAGE",message:"Новое",conversationId:conversation}});
    const ids=first.notifications.map((n:{id:string})=>n.id);let next=first.next;
    let pages=0;
    while(next){assert.ok(++pages<10,JSON.stringify(next));const r=await get(c,`?before=${next.before}&beforeId=${encodeURIComponent(next.beforeId)}`);assert.equal(r.status,200,JSON.stringify(r.body));ids.push(...r.body.notifications.map((n:{id:string})=>n.id));next=r.body.next;}
    assert.equal(ids.length,65);assert.equal(new Set(ids).size,65);
    await post(c,"/notifications/read",{ids:ids.slice(0,30)});
    const filtered=(await get(c,"?unread=1")).body;assert.equal(filtered.unread,36);assert.ok(filtered.notifications.every((n:{isRead:boolean})=>!n.isRead));
    assert.equal((await get(c,"?before=123")).status,400);assert.equal((await get(c,"?unread=bad")).status,400);
  });
});
