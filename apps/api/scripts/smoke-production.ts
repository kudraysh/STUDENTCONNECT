import assert from "node:assert/strict";
import {readFile,readdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {createServer} from "node:net";
import {spawn,type ChildProcess} from "node:child_process";
import {randomUUID} from "node:crypto";
import {PGlite} from "@electric-sql/pglite";
import {PGLiteSocketServer} from "@electric-sql/pglite-socket";
import {io,type Socket} from "socket.io-client";
import {hashPassword} from "../src/security.js";

// Настоящий собранный Node-сервер, но полностью изолированные БД и аккаунты.
// Тест не вызывает API Brevo и не отправляет писем.
const pg=await PGlite.create();
const dbServer=new PGLiteSocketServer({db:pg,port:0,host:"127.0.0.1"});
let child:ChildProcess|undefined,socket:Socket|undefined;
let output="";
async function stop(){
  socket?.disconnect();
  if(child && child.exitCode===null && child.signalCode===null){
    child.kill("SIGTERM");
    await Promise.race([new Promise<void>(resolve=>child!.once("exit",()=>resolve())),new Promise<void>(resolve=>setTimeout(resolve,5000))]);
    if(child.exitCode===null && child.signalCode===null)child.kill("SIGKILL");
  }
  await dbServer.stop();await pg.close();
}
try{
  for(const name of (await readdir(new URL("../prisma/migrations/",import.meta.url))).filter(n=>/^\d/.test(n)).sort())
    await pg.exec(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`,import.meta.url),"utf8"));
  const password="Isolated-Smoke-Password123!",hash=await hashPassword(password);
  await pg.query('INSERT INTO "StudyGroup" (id,name,course) VALUES ($1,$2,2)',["smoke-group","ТЕСТ-21"]);
  await pg.query('INSERT INTO "Category" (id,name) VALUES ($1,$2)',["smoke-category","Тест"]);
  await pg.query('INSERT INTO "Interest" (id,name,"normalizedName","categoryId") VALUES ($1,$2,$3,$4)',["smoke-interest","Тестирование","тестирование","smoke-category"]);
  for(const id of ["smoke-a","smoke-b"]){
    await pg.query('INSERT INTO "User" (id,email,"passwordHash","firstName","lastName","groupId","emailVerifiedAt") VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)',[id,`${id}@test.invalid`,hash,id,"Студент","smoke-group"]);
    await pg.query('INSERT INTO "UserInterest" ("userId","interestId") VALUES ($1,$2)',[id,"smoke-interest"]);
  }
  await dbServer.start();
  const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,"127.0.0.1",resolve));
  const address=reservation.address();assert.ok(address && typeof address==="object");const port=address.port;
  await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  const origin="https://smoke.studentconnect.invalid",base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,["dist/server.js"],{
    cwd:fileURLToPath(new URL("..",import.meta.url)),
    env:{...process.env,NODE_ENV:"production",SERVE_WEB:"1",PORT:String(port),WEB_ORIGIN:"",RENDER_EXTERNAL_URL:origin,TRUST_PROXY:"1",COOKIE_SAME_SITE:"lax",MAIL_MODE:"manual",BREVO_API_KEY:undefined,BREVO_SENDER_EMAIL:undefined,DATABASE_URL:`postgresql://postgres:postgres@${dbServer.getServerConn()}/postgres?connection_limit=1&sslmode=disable`},
    stdio:["ignore","pipe","pipe"],
  });
  child.stdout?.on("data",chunk=>{output+=chunk.toString();});child.stderr?.on("data",chunk=>{output+=chunk.toString();});
  let ready=false;
  for(let i=0;i<150;i++){
    if(child.exitCode!==null)throw new Error("Собранный сервер завершился до запуска");
    try{const r=await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,"Сервер не запустился за 15 секунд");
  const index=await fetch(`${base}/people/feed`,{headers:{Accept:"text/html"}});assert.equal(index.status,200);assert.match(await index.text(),/id="root"/);assert.equal(index.headers.get("cache-control"),"no-store");
  assert.ok(index.headers.get("content-security-policy")?.includes("wss://smoke.studentconnect.invalid"));
  assert.equal((await fetch(`${base}/api/ready`)).status,200);
  const login=await fetch(`${base}/api/auth/login`,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({email:"smoke-a@test.invalid",password})});
  assert.equal(login.status,200);const session=await login.json() as {csrfToken:string;user:{id:string}};
  const setCookie=login.headers.get("set-cookie") ?? "";assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/Secure/i);assert.match(setCookie,/SameSite=Lax/i);const cookie=setCookie.split(";")[0];
  assert.equal(session.user.id,"smoke-a");
  const headers={Origin:origin,Cookie:cookie,"Content-Type":"application/json","X-CSRF-Token":session.csrfToken};
  assert.equal((await fetch(`${base}/api/people`,{headers})).status,200);
  const conversation=await fetch(`${base}/api/chat/conversations`,{method:"POST",headers,body:JSON.stringify({peerId:"smoke-b"})});assert.equal(conversation.status,201);
  const {id}=await conversation.json() as {id:string};
  socket=io(base,{autoConnect:false,transports:["websocket"],extraHeaders:{Origin:origin,Cookie:cookie},auth:{csrfToken:session.csrfToken},reconnection:false});
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("Socket.IO connection timeout")),5000);
    socket!.once("connect",()=>{clearTimeout(timer);resolve();});socket!.once("connect_error",error=>{clearTimeout(timer);reject(error);});socket!.connect();
  });
  const delivery=new Promise<{text:string}>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("Socket.IO message timeout")),5000);
    socket!.once("chat:message",message=>{clearTimeout(timer);resolve(message);});
  });
  const sent=await fetch(`${base}/api/chat/conversations/${id}/messages`,{method:"POST",headers,body:JSON.stringify({text:"Изолированная проверка production",clientId:randomUUID()})});assert.equal(sent.status,201);assert.equal((await delivery).text,"Изолированная проверка production");
  assert.equal((await fetch(`${base}/api/not-existing`,{headers:{Accept:"text/html"}})).status,404);
  console.log("Production smoke passed: built SPA, deep link, readiness, Secure/HttpOnly cookie, authenticated API and Socket.IO message. No real email sent.");
}catch(error){
  // Здесь только изолированные данные; не печатаем даже тестовые cookie/пароли/ключи.
  console.error("Production smoke failed:",error instanceof Error?error.message:"unknown error");
  if(output.includes("Не найдена сборка"))console.error("Сначала выполни npm run build");
  process.exitCode=1;
}finally{await stop();}
