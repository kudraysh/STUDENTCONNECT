import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { createApp } from "./app.js";
import { newToken, hashToken, csrfFor } from "./security.js";

test("Этап 7: лента людей, интерес, пропуск и обучение",{timeout:120000},async t=>{
  const pg=await PGlite.create();
  for(const name of (await readdir(new URL("../prisma/migrations/",import.meta.url))).filter(n=>/^\d/.test(n)).sort())
    await pg.exec(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),"utf8"));
  const socket=new PGLiteSocketServer({db:pg,port:0,host:"127.0.0.1"});await socket.start();
  const db=new PrismaClient({datasourceUrl:`postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1&sslmode=disable`});
  t.after(async()=>{await db.$disconnect();await socket.stop();await pg.close();});
  const origin="http://localhost:5173";
  const app=createApp({origin,checkDatabase:async()=>{},accounts:{db,origin,cookie:{production:false,sameSite:"lax"},rateLimitMax:1000,mailer:{mode:"console",async sendVerification(){}}}});
  const group=await db.studyGroup.create({data:{name:"ИС-21",course:2}});
  const uni=await db.studyGroup.create({data:{name:"УНИ-21",course:2,institution:"МИЭТ, университет"}});
  const category=await db.category.create({data:{name:"Увлечения"}});
  const cs=await db.interest.create({data:{name:"CS2",normalizedName:"cs2",categoryId:category.id}});
  const ball=await db.interest.create({data:{name:"Баскетбол",normalizedName:"баскетбол",categoryId:category.id}});
  async function actor(name:string,interests=[cs.id,ball.id],verified=true,groupId=group.id){
    const user=await db.user.create({data:{firstName:name,lastName:"Студент",email:`${randomUUID()}@test.invalid`,passwordHash:"fixture",phone:"+79001234567",groupId,emailVerifiedAt:verified?new Date():null,interests:{create:interests.map(interestId=>({interestId}))}}});
    const token=newToken();await db.session.create({data:{userId:user.id,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+3600000)}});
    return {id:user.id,token,csrf:csrfFor(token)};
  }
  const a=await actor("Алиса"), b=await actor("Борис",[cs.id]), c=await actor("Карина"),d=await actor("Денис",[cs.id]);
  const pending=await actor("Не подтверждён",undefined,false), empty=await actor("Без интересов",[]),university=await actor("Университет",undefined,true,uni.id);
  type Actor=typeof a;
  const get=(who:Actor,path="/people/feed")=>request(app).get(`/api${path}`).set("Cookie",`sc_session=${who.token}`);
  const post=(who:Actor,path:string,body:object={})=>request(app).post(`/api${path}`).set("Cookie",`sc_session=${who.token}`).set("Origin",origin).set("X-CSRF-Token",who.csrf).send(body);
  const choice=(who:Actor,target:Actor,decision="LIKE")=>post(who,`/people/feed/${target.id}`,{decision});
  await t.test("лента требует сессию, подтверждение, колледж и интересы",async()=>{
    assert.equal((await request(app).get("/api/people/feed")).status,401);
    assert.equal((await get(pending)).status,403);assert.equal((await get(university)).status,403);assert.equal((await get(empty)).status,409);
    assert.equal((await choice(a,a)).status,400);
    assert.equal((await choice(a,pending)).status,404);assert.equal((await choice(a,university)).status,404);assert.equal((await choice(a,empty)).status,404);
    assert.equal((await post(a,"/people/feed/missing",{decision:"LIKE"})).status,404);
    assert.equal((await choice(a,b,"OTHER")).status,400);
    assert.equal((await request(app).post(`/api/people/feed/${b.id}`).set("Cookie",`sc_session=${a.token}`).send({decision:"LIKE"})).status,403);
    assert.equal((await request(app).post(`/api/people/feed/${b.id}`).set("Origin","https://evil.invalid").set("Cookie",`sc_session=${a.token}`).set("X-CSRF-Token",a.csrf).send({decision:"LIKE"})).status,403);
  });
  await t.test("карточки ранжируются по общим интересам и не содержат приватных полей",async()=>{
    const r=await get(a);assert.equal(r.status,200,JSON.stringify(r.body));
    assert.equal(r.body.remaining,3);assert.equal(r.body.person.id,c.id);assert.equal(r.body.person.commonCount,2);assert.equal(r.body.person.interests.length,2);assert.equal(r.body.tutorialRemaining,2);
    for(const key of ["email","phone","passwordHash","sessions","feedChoices"])assert.ok(!(key in r.body.person));
    assert.equal((await get(a)).body.tutorialRemaining,2); // просмотр без решения не расходует обучение
  });
  await t.test("интерес отправляет одно уведомление с профилем отправителя и исключает карточку",async()=>{
    const r=await choice(a,c);assert.equal(r.status,200);assert.equal(r.body.created,true);assert.equal(r.body.tutorialRemaining,1);
    const duplicate=await choice(a,c);assert.equal(duplicate.body.created,false);assert.equal(duplicate.body.tutorialRemaining,1);
    const n=(await get(c,"/notifications")).body;assert.equal(n.unread,1);assert.equal(n.notifications[0].kind,"PERSON_INTEREST");assert.equal(n.notifications[0].href,`/users/${a.id}`);assert.match(n.notifications[0].message,/Алиса/);
    assert.ok(!JSON.stringify(n).includes("79001234567"));assert.ok(!JSON.stringify(n).includes("test.invalid"));
    assert.notEqual((await get(a)).body.person.id,c.id);
    assert.equal((await db.feedChoice.findUniqueOrThrow({where:{actorId_targetId:{actorId:a.id,targetId:c.id}}})).decision,"LIKE");
    // Доступен путь из уведомления к публичному профилю и создание диалога.
    const profile=await get(c,`/users/${a.id}`);assert.equal(profile.status,200);assert.ok(!("phone" in profile.body.user));
    assert.equal((await post(c,"/chat/conversations",{peerId:a.id})).status,201);
  });
  await t.test("пропуск скрывает на 7 дней, не уведомляет и не влияет на общий каталог",async()=>{
    const before=Date.now(), result=await choice(a,b,"SKIP");assert.equal(result.status,200);assert.equal(result.body.tutorialRemaining,0);
    const expiry=new Date(result.body.hiddenUntil).getTime();assert.ok(expiry>=before+7*86400000 && expiry<=Date.now()+7*86400000);
    assert.equal((await get(a)).body.person.id,d.id);assert.equal((await get(b,"/notifications")).body.unread,0);
    assert.ok((await get(a,"/people")).body.users.some((u:{id:string})=>u.id===b.id));
    const duplicate=await choice(a,b,"SKIP");assert.equal(duplicate.body.created,false);assert.equal(duplicate.body.hiddenUntil,result.body.hiddenUntil);
    // RAW SQL сравнивает UTC timestamp независимо от TimeZone сервера.
    await db.$executeRawUnsafe("SET TIME ZONE 'Europe/Moscow'");
    await db.feedChoice.update({where:{actorId_targetId:{actorId:a.id,targetId:b.id}},data:{hiddenUntil:new Date(Date.now()+1800000)}});
    assert.equal((await get(a)).body.person.id,d.id);
    // Устаревшая вкладка не меняет уже сохранённый выбор.
    assert.equal((await choice(a,b,"LIKE")).body.decision,"SKIP");
    assert.equal((await get(b,"/notifications")).body.unread,0);
  });
  await t.test("после срока карточка возвращается, интерес не затрагивает ленту другого аккаунта",async()=>{
    await db.feedChoice.update({where:{actorId_targetId:{actorId:a.id,targetId:b.id}},data:{hiddenUntil:new Date(Date.now()-1000)}});
    assert.equal((await get(a)).body.person.id,b.id);
    const other=await get(b);assert.equal(other.body.remaining,3);assert.equal(other.body.tutorialRemaining,2);
    assert.equal((await choice(a,b)).body.created,true);assert.equal((await get(b,"/notifications")).body.unread,1);
    assert.equal((await choice(a,c,"SKIP")).body.decision,"LIKE");assert.equal((await get(a)).body.tutorialRemaining,0);
  });
  await t.test("параллельные решения не дублируют уведомления или шаги обучения",async()=>{
    const results=await Promise.all([choice(b,d),choice(b,d)]);assert.ok(results.every(r=>r.status===200));
    assert.equal(results.filter(r=>r.body.created).length,1);
    assert.equal(await db.notification.count({where:{userId:d.id,profileId:b.id,kind:"PERSON_INTEREST"}}),1);
    assert.equal((await get(b)).body.tutorialRemaining,1);
    const mixed=await Promise.all([choice(c,b,"SKIP"),choice(c,b,"LIKE")]);
    assert.ok(mixed.every(r=>r.status===200));assert.equal(mixed[0].body.decision,mixed[1].body.decision);
    assert.equal(mixed.filter(r=>r.body.created).length,1);assert.equal((await get(c)).body.tutorialRemaining,1);
    // Встречные интересы независимы.
    const mutual=await Promise.all([choice(c,d),choice(d,c)]);assert.ok(mutual.every(r=>r.status===200));
  });
  await t.test("обучение отключается навсегда для аккаунта, непрочитанные принадлежат адресату",async()=>{
    assert.equal((await post(b,"/people/feed/tutorial/dismiss")).status,200);assert.equal((await get(b)).body.tutorialRemaining,0);
    assert.equal((await choice(b,a)).body.tutorialRemaining,0);
    const n=(await get(c,"/notifications")).body.notifications.find((n:{kind:string;href:string})=>n.kind==="PERSON_INTEREST"&&n.href===`/users/${a.id}`);
    await post(a,"/notifications/read",{ids:[n.id]});assert.equal((await db.notification.findUniqueOrThrow({where:{id:n.id.slice(2)}})).isRead,false);
    await post(c,"/notifications/read",{ids:[n.id]});assert.equal((await db.notification.findUniqueOrThrow({where:{id:n.id.slice(2)}})).isRead,true);
  });
  await t.test("конец ленты возвращает пустое состояние без повторов",async()=>{
    await choice(a,d,"SKIP");const r=await get(a);assert.equal(r.status,200);assert.equal(r.body.person,null);assert.equal(r.body.remaining,0);
  });
});
