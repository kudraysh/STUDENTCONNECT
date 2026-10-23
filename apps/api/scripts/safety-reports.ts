import "dotenv/config";
import {PrismaClient} from "@prisma/client";
let db:PrismaClient|undefined;
try{
 const args=process.argv.slice(2);let id="",status="OPEN",resolve=false;
 for(let i=0;i<args.length;i++){if(args[i]==="--id"&&/^[a-z0-9_-]{1,64}$/i.test(args[i+1]??""))id=args[++i];else if(args[i]==="--status"&&["OPEN","RESOLVED","ALL"].includes(args[i+1]))status=args[++i];else if(args[i]==="--resolve")resolve=true;else throw new Error("Инструкция: --id <номер> или --status OPEN|RESOLVED|ALL; --id <номер> --resolve для закрытия жалобы");}
 if(resolve&&!id)throw new Error("Инструкция: для закрытия укажи --id");
 const url=process.env.ADMIN_DATABASE_URL;if(!url?.startsWith("postgresql://"))throw new Error("Инструкция: задай ADMIN_DATABASE_URL нужной базы");
 db=new PrismaClient({datasources:{db:{url}}});
 if(resolve){const result=await db.safetyReport.updateMany({where:{id},data:{status:"RESOLVED"}});if(!result.count)throw new Error("Жалоба не найдена");console.log("Жалоба отмечена рассмотренной. Содержимое и аккаунт автоматически не изменялись.");}
 else if(id){const report=await db.safetyReport.findUnique({where:{id}});console.log(JSON.stringify(report,null,2));}
 else console.log(JSON.stringify(await db.safetyReport.findMany({where:status==="ALL"?{}:{status},take:50,orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true,kind:true,targetId:true,reason:true,status:true,createdAt:true}}),null,2));
}catch(e){console.error(e instanceof Error&&(e.message.startsWith("Инструкция:")||e.message==="Жалоба не найдена")?e.message:"Не удалось обработать жалобы. Проверь подключение и миграции.");process.exitCode=1;}finally{await db?.$disconnect();}
