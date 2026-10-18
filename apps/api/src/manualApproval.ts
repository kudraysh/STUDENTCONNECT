import type { PrismaClient } from "@prisma/client";

// Только команда владельца с доступом к БД. HTTP-маршрута для допуска нет.
export async function approveDemoUser(db: PrismaClient, email: string) {
  return db.$transaction(async tx => {
    const user = await tx.user.findUnique({where:{email},select:{id:true,email:true,emailVerifiedAt:true}});
    if (!user) throw new Error("Аккаунт не найден");
    const changed = await tx.user.updateMany({where:{id:user.id,emailVerifiedAt:null},data:{emailVerifiedAt:new Date()}});
    await tx.emailVerification.deleteMany({where:{userId:user.id}});
    return {email:user.email,approved:true,changed:changed.count === 1};
  });
}
