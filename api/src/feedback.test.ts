import {test} from "node:test";
import {promisify} from "node:util";
import {execFile} from "node:child_process";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {PGLiteSocketServer} from "@electric-sql/pglite-socket";
import {PrismaClient} from "@prisma/client";
import request from "supertest";
import {createApp} from "./app.js";
import {newToken,hashToken,csrfFor} from "./security.js";

test("Этап 8: отчёты об ошибках, лимиты и приватность",{timeout:120000},async t=>{
  const pg=await PGlite.create();
  for(const name of (await readdir(new URL("../prisma/migrations/",import.meta.url))).filter(n=>/^\d/.test(n)).sort())
    await pg.exec(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),"utf8"));
  const socket=new PGLiteSocketServer({db:pg,port:0,host:"127.0.0.1"});await socket.start();
  const db=new PrismaClient({datasourceUrl:`postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1&sslmode=disable`});
  t.after(async()=>{await db.$disconnect();await socket.stop();await pg.close();});
  const origin="http://localhost:5173",ngrok="https://demo.ngrok-free.app";
  const app=createApp({origin,origins:[origin,ngrok],trustProxy:true,checkDatabase:async()=>{},accounts:{db,origin,cookie:{production:false,sameSite:"lax"},rateLimitMax:1000,mailer:{mode:"console",async sendVerification(){}}}});
  const group=await db.studyGroup.create({data:{name:"ИС-21",course:2}});
  async function actor(name:string,verified=true){
    const user=await db.user.create({data:{firstName:name,lastName:"Студент",email:`${randomUUID()}@test.invalid`,passwordHash:"fixture",groupId:group.id,emailVerifiedAt:verified?new Date():null}});
    const token=newToken();await db.session.create({data:{userId:user.id,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+3600000)}});
    return {id:user.id,token,csrf:csrfFor(token)};
  }
  const a=await actor("Алиса"),b=await actor("Борис"),pending=await actor("Не подтверждён",false);
  type Actor=typeof a;
  const get=(who:Actor,path="")=>request(app).get(`/api/feedback${path}`).set("Cookie",`sc_session=${who.token}`);
  const post=(who:Actor,body:object,from=origin)=>request(app).post("/api/feedback").set("Cookie",`sc_session=${who.token}`).set("Origin",from).set("X-CSRF-Token",who.csrf).send(body);
  const input=()=>({clientId:randomUUID(),area:"FEED",title:"Карточка не листается",steps:"Открыл ленту, нажал кнопку вправо",expected:"Появляется новая карточка",actual:"Карточка осталась на месте",page:"/people/feed",environment:"iPhone · Safari"});
  await t.test("сессия, подтверждение, CSRF, разрешённый Origin и JSON обязательны",async()=>{
    assert.equal((await request(app).get("/api/feedback")).status,401);
    assert.equal((await get(pending)).status,403);assert.equal((await post(pending,input())).status,403);
    assert.equal((await request(app).post("/api/feedback").set("Cookie",`sc_session=${a.token}`).set("Origin",origin).send(input())).status,403);
    assert.equal((await post(a,input(),"https://evil.invalid")).status,403);
    assert.equal((await request(app).post("/api/feedback").set("Cookie",`sc_session=${a.token}`).set("Origin",origin).set("X-CSRF-Token",a.csrf).type("form").send({title:"Ошибка"})).status,403);
  });
  await t.test("валидация полей и отказ от URL с токенами или подмены владельца/статуса",async()=>{
    for(const invalid of [{title:"a"},{steps:""},{expected:""},{actual:""},{area:"ADMIN"},{title:"x".repeat(121)},{environment:"x".repeat(161)},{clientId:"invalid"},{page:"https://example.com/verify#token=secret"},{page:"/verify?token=secret"},{page:"/verify#token=secret"},{status:"RESOLVED"},{userId:b.id}])
      assert.equal((await post(a,{...input(),...invalid})).status,400,JSON.stringify(invalid));
    assert.equal(await db.feedbackReport.count(),0);
  });
  let firstId="";
  await t.test("отчёт сохраняется и повтор не создаёт дубликат",async()=>{
    const body={...input(),title:"  Ошибка в карточке  "};
    const result=await post(a,body);assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(result.body.report.status,"OPEN");assert.equal(result.body.report.title,"Ошибка в карточке");firstId=result.body.report.id;
    assert.equal((await post(a,body)).status,200);assert.equal(await db.feedbackReport.count(),1);
    assert.equal((await post(a,{...body,actual:"Другой результат"})).status,409);
    const raw=JSON.stringify(result.body);assert.ok(!raw.includes("passwordHash"));assert.ok(!raw.includes("test.invalid"));assert.ok(!("userId" in result.body.report));assert.ok(!("clientId" in result.body.report));
  });
  await t.test("чужие отчёты скрыты, публичного управления отчётами нет",async()=>{
    assert.equal((await get(b)).body.total,0);assert.equal((await get(a)).body.total,1);
    assert.equal((await get(b,`/${firstId}`)).status,404);
    assert.equal((await request(app).patch(`/api/feedback/${firstId}`).set("Cookie",`sc_session=${b.token}`).set("Origin",origin).set("X-CSRF-Token",b.csrf).send({status:"RESOLVED"})).status,404);
    await db.feedbackReport.update({where:{id:firstId},data:{status:"RESOLVED"}});
    assert.equal((await get(a)).body.reports[0].status,"RESOLVED");
  });
  await t.test("текст остаётся обычным текстом, ngrok Origin принимается",async()=>{
    const body={...input(),title:"<script>alert('x')</script>",actual:"<img src=x onerror=alert(1)>"};
    const result=await post(b,body,ngrok);assert.equal(result.status,201,JSON.stringify(result.body));assert.equal(result.body.report.title,body.title);
    assert.equal((await get(b)).body.reports[0].actual,body.actual);
  });
  await t.test("параллельные одинаковые отправки создают один отчёт",async()=>{
    const body=input();const results=await Promise.all([post(b,body),post(b,body)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
    assert.equal(results[0].body.report.id,results[1].body.report.id);assert.equal(await db.feedbackReport.count({where:{userId:b.id}}),2);
  });
  await t.test("суточный лимит сохраняется в БД и пропускает повтор уже сохранённого запроса",async()=>{
    const u=await actor("Лимит");const bodies=Array.from({length:10},input);
    for(const body of bodies)assert.equal((await post(u,body)).status,201);
    assert.equal((await post(u,input())).status,429);
    assert.equal((await post(u,bodies[0])).status,200);
    assert.equal(await db.feedbackReport.count({where:{userId:u.id}}),10);
    const r=(await db.feedbackReport.findMany({where:{userId:u.id},take:1}))[0];
    await db.feedbackReport.update({where:{id:r.id},data:{createdAt:new Date(Date.now()-86400001)}});
    assert.equal((await post(u,input())).status,201);
    const page1=(await get(u)).body,page2=(await get(u,"?page=2")).body;assert.equal(page1.reports.length,10);assert.equal(page2.reports.length,1);assert.notEqual(page1.reports[0].id,page2.reports[0].id);
    assert.equal((await get(u,"?page=0")).status,400);
  });
  await t.test("параллельные последние места суточного лимита не превышают 10",async()=>{
    const u=await actor("Гонка");
    await db.feedbackReport.createMany({data:Array.from({length:9},()=>({...input(),userId:u.id}))});
    const results=await Promise.all([post(u,input()),post(u,input())]);assert.deepEqual(results.map(r=>r.status).sort(),[201,429]);assert.equal(await db.feedbackReport.count({where:{userId:u.id}}),10);
  });
  await t.test("истёкшая сессия не читает и не создаёт отчёты",async()=>{
    const u=await actor("Истёк");await db.session.updateMany({where:{userId:u.id},data:{expiresAt:new Date(Date.now()-1000)}});
    assert.equal((await get(u)).status,401);assert.equal((await post(u,input())).status,401);
  });
  await t.test("локальная команда разработчика читает отчёт без вывода секретов подключения",async()=>{
    const datasourceUrl=`postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1&sslmode=disable`;
    await db.$disconnect();await pg.exec("DEALLOCATE ALL");
    const result=await promisify(execFile)(process.execPath,["--import","tsx","scripts/feedback-list.ts","--id",firstId],{
      cwd:fileURLToPath(new URL("..",import.meta.url)),env:{...process.env,DATABASE_URL:datasourceUrl},timeout:15000,
    });
    const reports=JSON.parse(result.stdout);assert.equal(reports.length,1);assert.equal(reports[0].id,firstId);assert.equal(reports[0].status,"RESOLVED");
    assert.ok(!result.stdout.includes("postgresql://"));assert.ok(!result.stdout.includes("passwordHash"));assert.ok(!result.stdout.includes("test.invalid"));
  });

});
