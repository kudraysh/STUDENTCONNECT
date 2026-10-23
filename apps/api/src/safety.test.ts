import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {PGLiteSocketServer} from "@electric-sql/pglite-socket";
import {PrismaClient} from "@prisma/client";
import request from "supertest";
import {createApp} from "./app.js";
import {ChatService} from "./chat.js";
import {newToken,hashToken,csrfFor} from "./security.js";

test("Чат и безопасность: права, ответы, удаление, блокировки, жалобы",{timeout:120000},async t=>{
 const pg=await PGlite.create(),socket=new PGLiteSocketServer({db:pg,host:"127.0.0.1",port:0});
 for(const name of (await readdir(new URL("../prisma/migrations/",import.meta.url))).filter(x=>/^\d/.test(x)).sort())await pg.exec(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),"utf8"));
 await socket.start();const db=new PrismaClient({datasourceUrl:`postgresql://postgres:postgres@${socket.getServerConn()}/postgres?connection_limit=1&sslmode=disable`});
 t.after(async()=>{await db.$disconnect();await socket.stop();await pg.close();});
 const origin="http://localhost:5173",chat=new ChatService(db);
 const app=createApp({origin,checkDatabase:async()=>{},accounts:{db,origin,chat,rateLimitMax:1000,cookie:{production:false,sameSite:"lax"},mailer:{mode:"manual",async sendVerification(){}}}});
 const group=await db.studyGroup.create({data:{name:"ТЕСТ-21",course:2}}),category=await db.category.create({data:{name:"Спорт"}}),interest=await db.interest.create({data:{name:"Баскетбол",normalizedName:"баскетбол",categoryId:category.id}});
 async function actor(name:string,verified=true){const user=await db.user.create({data:{firstName:name,lastName:"Тест",email:`${randomUUID()}@test.invalid`,passwordHash:"fixture",groupId:group.id,emailVerifiedAt:verified?new Date():null,phone:"+79001234567",interests:{create:{interestId:interest.id}}}});const token=newToken();await db.session.create({data:{userId:user.id,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+3600000)}});return {...user,token,csrf:csrfFor(token)};}
 const a=await actor("А"),b=await actor("Б"),c=await actor("В"),unverified=await actor("Г",false);
 type Actor=typeof a;
 function req(who:Actor,method:"get"|"post"|"patch"|"delete",path:string,body?:object){const q=request(app)[method](`/api${path}`).set("Cookie",`sc_session=${who.token}`).set("Origin",origin).set("X-CSRF-Token",who.csrf);return method==="get"?q:q.send(body??{});}
 const ab=(await req(a,"post","/chat/conversations",{peerId:b.id})).body.id as string;
 const ac=(await req(a,"post","/chat/conversations",{peerId:c.id})).body.id as string;
 const send=(who:Actor,text:string,replyToId?:number,cid=ab)=>req(who,"post",`/chat/conversations/${cid}/messages`,{text,clientId:randomUUID(),...(replyToId?{replyToId}:{})});
 const history=async(who:Actor)=>(await req(who,"get",`/chat/conversations/${ab}/messages`)).body.messages as {id:number;text:string;replyTo:{text:string;unavailable:boolean};deletedAt:string|null;hiddenForMe:boolean;editedAt:string|null}[];
 let first=0,reply=0;
 await t.test("Unicode-смайлики сохраняются, редактировать чужое и чужой диалог нельзя",async()=>{
  const r=await send(a,"Привет 😀🏀");assert.equal(r.status,201);first=r.body.message.id;assert.equal(r.body.message.text,"Привет 😀🏀");assert.ok(!("hiddenFor" in r.body.message));
  assert.equal((await req(b,"patch",`/chat/conversations/${ab}/messages/${first}`,{text:"чужое"})).status,403);
  assert.equal((await req(c,"delete",`/chat/conversations/${ab}/messages/${first}`,{scope:"self"})).status,404);
  assert.equal((await req(a,"patch",`/chat/conversations/${ab}/messages/${first}`,{text:" "})).status,400);
 });
 await t.test("ответ только на доступное сообщение этого диалога",async()=>{
  const r=await send(b,"Ответ 👍",first);assert.equal(r.status,201);reply=r.body.message.id;assert.equal(r.body.message.replyTo.text,"Привет 😀🏀");
  const other=(await send(a,"Другой диалог",undefined,ac)).body.message.id;
  assert.equal((await send(b,"Подделка",other)).status,400);
 });
 await t.test("редактирование обновляет текст и цитаты, ID не меняется",async()=>{
  assert.equal((await req(a,"patch",`/chat/conversations/${ab}/messages/${first}`,{text:"Исправлено ❤️"})).status,200);
  const rows=await history(b);assert.equal(rows.find(m=>m.id===first)?.text,"Исправлено ❤️");assert.ok(rows.find(m=>m.id===first)?.editedAt);assert.equal(rows.find(m=>m.id===reply)?.replyTo.text,"Исправлено ❤️");
  const sync=await req(b,"get",`/chat/conversations/${ab}/messages?ids=${first},${reply}`);assert.equal(sync.status,200);assert.equal(sync.body.messages.length,2);
 });
 await t.test("удаление у себя не раскрывается в цитатах и не меняет историю собеседника",async()=>{
  assert.equal((await req(b,"delete",`/chat/conversations/${ab}/messages/${first}`,{scope:"self"})).status,200);
  const rows=await history(b);assert.equal(rows.find(m=>m.id===first)?.hiddenForMe,true);assert.equal(rows.find(m=>m.id===first)?.text,"");assert.equal(rows.find(m=>m.id===reply)?.replyTo.text,"Сообщение недоступно");
  assert.equal((await history(a)).find(m=>m.id===first)?.text,"Исправлено ❤️");assert.equal((await send(b,"Ответ на скрытое",first)).status,400);
 });
 await t.test("Socket.IO-событие персонализирует цитату и не раскрывает скрытый текст",async()=>{
  const events:{users:string[];message:{replyTo:{text:string};hiddenFor?:unknown}}[]=[];
  const listener=(value:typeof events[number])=>events.push(value);chat.on("message",listener);
  try{assert.equal((await send(a,"Цитата",first)).status,201);}finally{chat.off("message",listener);}
  assert.equal(events.find(e=>e.users.includes(a.id))?.message.replyTo.text,"Исправлено ❤️");
  assert.equal(events.find(e=>e.users.includes(b.id))?.message.replyTo.text,"Сообщение недоступно");
  assert.ok(events.every(e=>!("hiddenFor" in e.message)));
 });
 const reportId=randomUUID();let receipt="";
 await t.test("жалоба участника сохраняет снимок сообщения; посторонний не может пожаловаться",async()=>{
  const r=await req(a,"post","/safety/reports",{kind:"MESSAGE",targetId:String(reply),reason:"ABUSE",details:"Проверка",clientId:reportId});assert.equal(r.status,201);receipt=r.body.id;
  const stored=await db.safetyReport.findUniqueOrThrow({where:{id:receipt}});assert.equal((stored.snapshot as {text:string}).text,"Ответ 👍");
  const duplicate=await req(a,"post","/safety/reports",{kind:"MESSAGE",targetId:String(reply),reason:"ABUSE",details:"Проверка",clientId:reportId});assert.equal(duplicate.body.id,receipt);
  assert.equal((await req(c,"post","/safety/reports",{kind:"MESSAGE",targetId:String(reply),reason:"ABUSE",clientId:randomUUID()})).status,404);
  assert.equal((await req(a,"post","/safety/reports",{kind:"MESSAGE",targetId:String(first),reason:"ABUSE",clientId:randomUUID()})).status,400);
 });
 await t.test("удалить у всех можно только своё, исходный текст исчезает и цитата становится недоступной",async()=>{
  assert.equal((await req(a,"delete",`/chat/conversations/${ab}/messages/${reply}`,{scope:"everyone"})).status,403);
  assert.equal((await req(a,"delete",`/chat/conversations/${ab}/messages/${first}`,{scope:"everyone"})).status,200);
  for(const who of [a,b]){const rows=await history(who);assert.equal(rows.find(m=>m.id===first)?.text,"");assert.ok(rows.find(m=>m.id===first)?.deletedAt);assert.equal(rows.find(m=>m.id===reply)?.replyTo.unavailable,true);}
  assert.equal((await req(a,"patch",`/chat/conversations/${ab}/messages/${first}`,{text:"Восстановить"})).status,409);
  assert.equal((await send(b,"Снова",first)).status,400);
  const list=await req(b,"get","/chat/conversations");assert.ok(!JSON.stringify(list.body).includes("Исправлено"));
 });
 await t.test("жалобы на профиль и аватар сохраняются без почты и пароля",async()=>{
  const r=await req(a,"post","/safety/reports",{kind:"USER",targetId:b.id,reason:"AVATAR",clientId:randomUUID()});assert.equal(r.status,201);
  const row=await db.safetyReport.findUniqueOrThrow({where:{id:r.body.id}});assert.ok(!("passwordHash" in (row.snapshot as object)));assert.ok(!("email" in (row.snapshot as object)));
  assert.equal((await req(a,"post","/safety/reports",{kind:"USER",targetId:a.id,reason:"PROFILE",clientId:randomUUID()})).status,400);
  assert.equal((await req(a,"get","/safety/reports")).status,404);
 });
 await t.test("жалоба на мероприятие сохраняет содержимое, чужая и собственная цель проверяются",async()=>{
  const event=await db.event.create({data:{title:"Тест",description:"Описание",place:"Колледж",startsAt:new Date(Date.now()+86400000),capacity:5,organizerId:b.id,categoryId:category.id}});
  const r=await req(a,"post","/safety/reports",{kind:"EVENT",targetId:event.id,reason:"SPAM",clientId:randomUUID()});assert.equal(r.status,201);
  assert.equal((await req(b,"post","/safety/reports",{kind:"EVENT",targetId:event.id,reason:"SPAM",clientId:randomUUID()})).status,400);
  assert.equal((await req(a,"post","/safety/reports",{kind:"EVENT",targetId:"missing",reason:"SPAM",clientId:randomUUID()})).status,404);
 });
 await t.test("CSRF и подтверждение аккаунта обязательны",async()=>{
  assert.equal((await request(app).post(`/api/safety/blocks/${b.id}`).set("Cookie",`sc_session=${a.token}`).set("Origin",origin)).status,403);
  assert.equal((await req(unverified,"post",`/safety/blocks/${b.id}`)).status,403);
  assert.equal((await req(a,"post",`/safety/blocks/${a.id}`)).status,400);
 });
 await t.test("блокировка прекращает общение в обе стороны, отзывает телефон и скрывает поиск/ленту",async()=>{
  await db.phoneAccess.create({data:{ownerId:b.id,requesterId:a.id,status:"APPROVED"}});
  assert.equal((await req(a,"post",`/safety/blocks/${b.id}`)).status,200);
  assert.equal((await send(a,"Нельзя")).status,403);assert.equal((await send(b,"Тоже нельзя")).status,403);
  assert.equal((await req(b,"post","/chat/conversations",{peerId:a.id})).status,403);
  assert.equal((await req(a,"post",`/chat/conversations/${ab}/phone`)).status,403);
  const details=await req(a,"get",`/chat/conversations/${ab}`);assert.equal(details.body.phone,null);assert.equal(details.body.unavailable,true);
  assert.equal((await db.phoneAccess.findFirstOrThrow()).status,"REVOKED");
  for(const [who,peer] of [[a,b],[b,a]]){const people=await req(who,"get","/people");assert.ok(!people.body.users.some((u:{id:string})=>u.id===peer.id));assert.equal((await req(who,"post",`/people/feed/${peer.id}`,{decision:"LIKE"})).status,403);}
  assert.ok((await history(a)).length>0);
 });
 await t.test("снять чужую блокировку нельзя; взаимные блокировки независимы",async()=>{
  await req(b,"delete",`/safety/blocks/${a.id}`);assert.equal((await send(b,"Нельзя")).status,403);
  await req(b,"post",`/safety/blocks/${a.id}`);await req(a,"delete",`/safety/blocks/${b.id}`);assert.equal((await send(a,"Нельзя")).status,403);
  await req(b,"delete",`/safety/blocks/${a.id}`);assert.equal((await send(a,"Снова можно")).status,201);
  assert.equal((await req(a,"get",`/chat/conversations/${ab}`)).body.phone,null);
 });
 await t.test("лимит жалоб и конфликт повторного ключа",async()=>{
  assert.equal((await req(a,"post","/safety/reports",{kind:"USER",targetId:b.id,reason:"SPAM",clientId:reportId})).status,409);
  const count=await db.safetyReport.count({where:{reporterId:a.id}});
  for(let n=count;n<10;n++)assert.equal((await req(a,"post","/safety/reports",{kind:"USER",targetId:b.id,reason:"SPAM",clientId:randomUUID()})).status,201);
  assert.equal((await req(a,"post","/safety/reports",{kind:"USER",targetId:b.id,reason:"SPAM",clientId:randomUUID()})).status,429);
 });
});

test("миграция чата сохраняет существующие сообщения и ограничения текста",async t=>{
 const pg=await PGlite.create();t.after(()=>pg.close());
 const names=(await readdir(new URL("../prisma/migrations/",import.meta.url))).filter(x=>/^\d/.test(x)).sort();
 for(const name of names.filter(x=>x!=="20261018195000_chat_safety"))await pg.exec(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),"utf8"));
 await pg.exec(`INSERT INTO "StudyGroup" (id,name,course) VALUES ('g','ТЕСТ',1);
 INSERT INTO "User" (id,email,"passwordHash","firstName","lastName","groupId") VALUES ('a','a@test.invalid','fixture','А','Тест','g'),('b','b@test.invalid','fixture','Б','Тест','g');
 INSERT INTO "Conversation" (id,"userAId","userBId") VALUES ('c','a','b');
 INSERT INTO "ChatMessage" ("conversationId","senderId","clientId",text) VALUES ('c','a','legacy-message','Старая переписка 😀');`);
 await pg.exec(await readFile(new URL("../prisma/migrations/20261018195000_chat_safety/migration.sql",import.meta.url),"utf8"));
 const {rows}=await pg.query<{text:string;deletedAt:null;replyToId:null}>('SELECT text,"deletedAt","replyToId" FROM "ChatMessage"');assert.equal(rows[0].text,"Старая переписка 😀");assert.equal(rows[0].deletedAt,null);assert.equal(rows[0].replyToId,null);
 await assert.rejects(pg.exec(`UPDATE "ChatMessage" SET text=''`),/ChatMessage_text_check/);
 await pg.exec(`UPDATE "ChatMessage" SET text='',"deletedAt"=CURRENT_TIMESTAMP`);
 assert.equal((await pg.query<{text:string}>('SELECT text FROM "ChatMessage"')).rows[0].text,"");
});
