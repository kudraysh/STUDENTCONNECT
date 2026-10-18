import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import request from "supertest";
import {createApp} from "./app.js";
import {parseSettings} from "./settings.js";
import {createMailer} from "./mail.js";
const base={DATABASE_URL:"postgresql://fixture:fixture@localhost/test",WEB_ORIGIN:"https://demo.onrender.com/",NODE_ENV:"production",MAIL_MODE:"brevo",BREVO_API_KEY:"fixture-private-key",BREVO_SENDER_EMAIL:"sender@test.invalid"};
test("production: канонический HTTPS origin, Brevo и безопасные cookie-настройки",()=>{
  const c=parseSettings(base);assert.equal(c.WEB_ORIGIN,"https://demo.onrender.com");assert.equal(c.COOKIE_SAME_SITE,"lax");assert.equal(c.MAIL_MODE,"brevo");
});
test("production запрещает console-почту и HTTP",()=>{
  assert.throws(()=>parseSettings({...base,MAIL_MODE:"console"}),/настоящая почта/);
  assert.throws(()=>parseSettings({...base,WEB_ORIGIN:"http://example.com"}),/HTTPS/);
});
test("origin не допускает путь, query, fragment, credentials и чужую схему",()=>{
  for(const WEB_ORIGIN of ["https://example.com/path","https://example.com/?token=x","https://example.com/#token=x","https://user:password@example.com","ftp://example.com"])
    assert.throws(()=>parseSettings({...base,WEB_ORIGIN}),/WEB_ORIGIN/);
});
test("Brevo и SMTP требуют свои параметры, ошибки не содержат значения секретов",()=>{
  assert.throws(()=>parseSettings({...base,BREVO_API_KEY:undefined}),/BREVO_API_KEY/);
  assert.throws(()=>parseSettings({...base,BREVO_SENDER_EMAIL:undefined}),/BREVO_SENDER_EMAIL/);
  assert.throws(()=>parseSettings({...base,MAIL_MODE:"smtp"}),/SMTP_HOST/);
  try{parseSettings({...base,DATABASE_URL:"very-secret-value"});assert.fail();}catch(e){assert.ok(!String(e).includes("very-secret-value"));}
});
test("локальная разработка сохраняет console и не допускает SameSite=None без production",()=>{
  assert.equal(parseSettings({DATABASE_URL:base.DATABASE_URL}).MAIL_MODE,"console");
  assert.throws(()=>parseSettings({DATABASE_URL:base.DATABASE_URL,COOKIE_SAME_SITE:"none"}),/SameSite/);
});
test("HTTP-почта: правильные URL, заголовки и текст без открытого токена в логах",async()=>{
  let calls=0;
  const options=parseSettings(base);
  const mailer=createMailer(options,{fetch:async(url,init)=>{
    calls++;assert.equal(String(url),"https://api.brevo.com/v3/smtp/email");assert.equal(init?.method,"POST");assert.equal(init?.redirect,"error");
    const headers=init?.headers as Record<string,string>;assert.equal(headers["api-key"],base.BREVO_API_KEY);
    const body=JSON.parse(String(init?.body));assert.deepEqual(body.to,[{email:"recipient@test.invalid"}]);assert.equal(body.sender.email,base.BREVO_SENDER_EMAIL);assert.ok(body.textContent.includes("#token=fixture"));assert.ok(!("htmlContent" in body));assert.ok(init?.signal);
    return new Response(JSON.stringify({messageId:"fixture"}),{status:201});
  }});
  assert.equal(mailer.mode,"brevo");await mailer.sendVerification({to:"recipient@test.invalid",url:"https://demo.onrender.com/verify#token=fixture"});assert.equal(calls,1);
});
test("ошибка HTTP-провайдера не раскрывает ответ, ключ или ссылку подтверждения",async()=>{
  const mailer=createMailer(parseSettings(base),{fetch:async()=>new Response("fixture-private-key token=private recipient@test.invalid",{status:400})});
  await assert.rejects(mailer.sendVerification({to:"recipient@test.invalid",url:"https://example.com/#token=private"}),e=>String(e)==="Error: Не удалось отправить письмо через Brevo");
});
test("сетевой отказ почты обрабатывается без секретных деталей",async()=>{
  const mailer=createMailer(parseSettings(base),{fetch:async()=>{throw new Error("fixture-private-key token=private");}});
  await assert.rejects(mailer.sendVerification({to:"recipient@test.invalid",url:"https://example.com/#token=private"}),/Не удалось отправить письмо через Brevo/);
});
test("неполная конфигурация Brevo не переходит незаметно в console-режим",()=>{
  assert.throws(()=>createMailer({MAIL_MODE:"brevo",SMTP_PORT:587,MAIL_FROM:"fixture"}),/API-ключ/);
});
test("единый сервер: SPA-переходы, кеш, API, CSP и защита файлов",async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),"sc-web-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,"assets"));await writeFile(path.join(dir,"index.html"),"<!doctype html><html><div id='root'>fixture-spa</div></html>");await writeFile(path.join(dir,"assets/app-123.js"),"/* fixture-asset */");await writeFile(path.join(dir,".env"),"PRIVATE_SECRET=fixture");
  const app=createApp({origin:"https://demo.onrender.com",webDirectory:dir,checkDatabase:async()=>{}});
  for(const url of ["/","/people/feed","/messages/fixture","/verify","/feedback"]){
    const r=await request(app).get(url).set("Accept","text/html");assert.equal(r.status,200,url);assert.match(r.text,/fixture-spa/);assert.equal(r.headers["cache-control"],"no-store");
    assert.ok(r.headers["content-security-policy"].includes("wss://demo.onrender.com"));
  }
  const asset=await request(app).get("/assets/app-123.js");assert.equal(asset.status,200);assert.match(asset.headers["cache-control"],/immutable/);
  for(const url of ["/api/missing","/api","/socket.io/missing","/assets/missing.js","/src/server.ts","/.env"]){
    const r=await request(app).get(url).set("Accept","text/html");assert.equal(r.status,404,url);assert.ok(!r.text.includes("PRIVATE_SECRET"));assert.ok(!r.text.includes("fixture-spa"));
  }
  const head=await request(app).head("/people/feed").set("Accept","text/html");assert.equal(head.status,200);assert.ok(!head.text);
  assert.equal((await request(app).get("/api/health")).body.status,"ok");
});
test("без сборки production-сервер завершается с понятной ошибкой",()=>{
  assert.throws(()=>createApp({origin:"https://example.com",webDirectory:"/does-not-exist-sc-web",checkDatabase:async()=>{}}),/npm run build/);
});


test("Render origin берётся из служебной переменной при едином production-сервере",()=>{
  const config=parseSettings({...base,WEB_ORIGIN:undefined,SERVE_WEB:"1",RENDER_EXTERNAL_URL:"https://actual-service.onrender.com"});
  assert.equal(config.WEB_ORIGIN,"https://actual-service.onrender.com");
  assert.equal(parseSettings({...base,SERVE_WEB:"1",RENDER_EXTERNAL_URL:"https://other.onrender.com"}).WEB_ORIGIN,"https://demo.onrender.com");
  assert.throws(()=>parseSettings({...base,WEB_ORIGIN:undefined,SERVE_WEB:"0",RENDER_EXTERNAL_URL:"https://ignored.onrender.com"}),/HTTPS/);
});

test("manual работает в production без почтовых секретов и не отправляет запросы",async()=>{
  const c=parseSettings({...base,MAIL_MODE:"manual",BREVO_API_KEY:undefined,BREVO_SENDER_EMAIL:undefined});
  let calls=0;const mailer=createMailer(c,{fetch:async()=>{calls++;throw new Error("unexpected-network");}});
  assert.equal(mailer.mode,"manual");
  await mailer.sendVerification({to:"fixture@test.invalid",url:"https://demo.invalid/#token=private"});
  assert.equal(calls,0);
});
