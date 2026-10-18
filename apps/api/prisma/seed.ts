import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const categories: Record<string, string[]> = {
 'Видеоигры': ['CS2', 'Dota 2', 'Minecraft', 'Valorant'],
 'Спорт': ['Баскетбол', 'Футбол', 'Волейбол', 'Теннис'],
 'Программирование': ['Python', 'JavaScript', 'Java', 'C++'],
 'Музыка': ['Гитара'], 'Учёба': ['Математика'], 'Творчество': ['Рисование'],
 'Кино': ['Кинопросмотры'], 'Настольные игры': ['Шахматы'], 'Другие увлечения': ['Путешествия'],
};
async function main() {
 await prisma.$transaction(async tx => {
  await tx.studyGroup.upsert({ where: { name: 'ИС-21' }, update: {}, create: { name: 'ИС-21', course: 2 } });
  for (const [name, interests] of Object.entries(categories)) {
   const category = await tx.category.upsert({ where: { name }, update: {}, create: { name } });
   for (const interest of interests) {
    const normalizedName = interest.toLocaleLowerCase('ru').trim();
    await tx.interest.upsert({ where: { normalizedName }, update: {}, create: { name: interest, normalizedName, categoryId: category.id } });
   }
  }
 }, {maxWait:10000, timeout:30000});
 console.log('Справочники созданы. Тестовых аккаунтов с паролями нет.');
}
main().catch(error => { console.error('Не удалось создать справочники. Проверь подключение к PostgreSQL и миграции.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
