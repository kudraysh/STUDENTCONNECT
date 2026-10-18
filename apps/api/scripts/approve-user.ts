import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { approveDemoUser } from "../src/manualApproval.js";

let db: PrismaClient | undefined;
try {
  const args=process.argv.slice(2);
  if(args.length!==3 || args[0]!=="--email" || args[2]!=="--confirm")
    throw new Error("Инструкция: users:approve -- --email friend@example.com --confirm");
  const email=z.string().trim().toLowerCase().email().parse(args[1]);
  // Отдельный секрет исключает случайную работу с локальной DATABASE_URL.
  const url=process.env.ADMIN_DATABASE_URL;
  if(!url?.startsWith("postgresql://")) throw new Error("Инструкция: задай ADMIN_DATABASE_URL для нужной базы Neon");
  const target=new URL(url);
  console.log(`База: ${target.hostname}${target.pathname}`);
  db=new PrismaClient({datasources:{db:{url}}});
  console.log(JSON.stringify(await approveDemoUser(db,email)));
} catch(error) {
  console.error(error instanceof Error && (error.message.startsWith("Инструкция:") || error.message==="Аккаунт не найден") ? error.message : "Не удалось подтвердить аккаунт. Проверь адрес почты, подключение к базе и миграции.");
  process.exitCode=1;
} finally { await db?.$disconnect(); }
