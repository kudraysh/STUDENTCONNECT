import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Локальная команда разработчика. Публичного API для чужих отчётов нет.
const db = new PrismaClient();
async function main(){
  const args=process.argv.slice(2);
  let status="OPEN",limit=20,id="";
  for(let i=0;i<args.length;i++){
    const flag=args[i],value=args[++i];
    if(value===undefined)throw new Error("Аргументы: после флага укажи значение");
    if(flag==="--status" && ["OPEN","RESOLVED","ALL"].includes(value))status=value;
    else if(flag==="--limit" && /^\d+$/.test(value) && Number(value)>=1 && Number(value)<=100)limit=Number(value);
    else if(flag==="--id" && /^[a-z0-9_-]{1,64}$/i.test(value))id=value;
    else throw new Error("Аргументы: --status OPEN|RESOLVED|ALL --limit 1..100 или --id <номер>");
  }
  if(!process.env.DATABASE_URL)throw new Error("Укажи DATABASE_URL в apps/api/.env");
  const reports=id ? await db.feedbackReport.findMany({where:{id},select:{id:true,title:true,area:true,status:true,page:true,environment:true,steps:true,expected:true,actual:true,createdAt:true,updatedAt:true}})
    : await db.feedbackReport.findMany({where:status==="ALL"?{}:{status},take:limit,orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true,title:true,area:true,status:true,createdAt:true}});
  // JSON экранирует управляющие символы пользовательского текста в терминале.
  console.log(JSON.stringify(reports,null,2));
}
try{await main();}catch(error){
  console.error(error instanceof Error && (error.message.startsWith("Аргументы:") || error.message.startsWith("Укажи DATABASE_URL"))?error.message:"Не удалось прочитать отчёты. Проверь PostgreSQL, DATABASE_URL и миграции.");
  process.exitCode=1;
}finally{await db.$disconnect();}
