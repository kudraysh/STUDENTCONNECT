import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "./app.js";
const origin = "http://localhost:5173";
test("health работает даже при недоступной БД", async () => {
  const app = createApp({
    origin,
    checkDatabase: async () => {
      throw new Error("offline");
    },
  });
  const result = await request(app).get("/api/health");
  assert.equal(result.status, 200);
  assert.equal(result.body.status, "ok");
});
test("readiness выполняет проверку БД и возвращает 503 при отказе", async () => {
  let calls = 0;
  const app = createApp({
    origin,
    checkDatabase: async () => {
      calls++;
      throw new Error("secret connection string");
    },
  });
  const result = await request(app).get("/api/ready");
  assert.equal(calls, 1);
  assert.equal(result.status, 503);
  assert.equal(result.body.database, "disconnected");
  assert.ok(!JSON.stringify(result.body).includes("secret"));
});
test("readiness подтверждает успешное подключение и CORS", async () => {
  const app = createApp({ origin, checkDatabase: async () => {} });
  const result = await request(app).get("/api/ready").set("Origin", origin);
  assert.equal(result.status, 200);
  assert.equal(result.body.database, "connected");
  assert.equal(result.headers["access-control-allow-origin"], origin);
  assert.equal(result.headers["access-control-allow-credentials"], "true");
});
test("неизвестный маршрут возвращает JSON 404", async () => {
  const app = createApp({ origin, checkDatabase: async () => {} });
  const result = await request(app).get("/api/missing");
  assert.equal(result.status, 404);
});


test("ngrok: явный trust proxy включает один хоп, записи требуют точный разрешённый Origin",async()=>{
  const ngrok="https://demo.ngrok-free.app";
  const app=createApp({origin:ngrok,trustProxy:true,checkDatabase:async()=>{}});
  assert.equal(app.get("trust proxy"),1);
  const health=await request(app).get("/api/health").set("Origin",ngrok).set("X-Forwarded-For","203.0.113.42");
  assert.equal(health.status,200);assert.equal(health.headers["access-control-allow-origin"],ngrok);assert.equal(health.headers["cache-control"],"no-store");
  const wrong=await request(app).post("/api/not-existing").set("Origin","https://old.ngrok-free.app").send({});assert.equal(wrong.status,403);
  const allowed=await request(app).post("/api/not-existing").set("Origin",ngrok).send({});assert.equal(allowed.status,404);
  assert.notEqual(createApp({origin,checkDatabase:async()=>{}}).get("trust proxy"),true);
});
