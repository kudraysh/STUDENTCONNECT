import { z } from "zod";
// Общие ошибки Zod тоже должны быть на русском, включая некорректные API-запросы.
z.setErrorMap((issue) => {
  if (issue.code === "too_big")
    return { message: "Превышен допустимый размер поля" };
  if (issue.code === "too_small")
    return { message: "Заполните поле: значение слишком короткое" };
  if (issue.code === "invalid_string")
    return { message: "Некорректный формат поля" };
  return { message: "Проверьте значение поля" };
});
const name = z
  .string()
  .trim()
  .min(1, "Обязательное поле")
  .max(50, "Не более 50 символов")
  .regex(/^[\p{L}][\p{L} '\u2019-]*$/u, "Используйте буквы, пробелы и дефис");
const nickname = z
  .string()
  .trim()
  .toLowerCase()
  .max(24)
  .refine(
    (v) => !v || /^[a-z0-9_]{3,24}$/.test(v),
    "Псевдоним: 3–24 латинские буквы, цифры или _",
  )
  .default("");
const phone = z
  .string()
  .trim()
  .max(30)
  .refine(
    (v) =>
      !v ||
      (/^\+?[0-9 ()-]+$/.test(v) &&
        v.replace(/\D/g, "").length >= 7 &&
        v.replace(/\D/g, "").length <= 15),
    "Некорректный номер телефона",
  )
  .default("");
export const profileSchema = z.object({
  firstName: name,
  lastName: name,
  nickname,
  group: z
    .string()
    .trim()
    .min(2)
    .max(24)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} -]+$/u, "Некорректная группа")
    .transform((v) => v.replace(/\s+/g, " ").toUpperCase()),
  course: z.coerce.number().int().min(1).max(6),
  interestIds: z
    .array(z.string().min(1).max(64))
    .min(1, "Выберите хотя бы один конкретный интерес")
    .max(20)
    .refine(
      (a) => new Set(a).size === a.length,
      "Интересы не должны повторяться",
    ),
  phone,
  bio: z
    .string()
    .trim()
    .max(500, "Описание — не более 500 символов")
    .default(""),
  avatar: z.string().max(1500000).nullable().optional(),
});
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Введите корректную почту")
  .max(254);
export const registerSchema = profileSchema.extend({
  email: emailSchema,
  password: z
    .string()
    .min(10, "Пароль — минимум 10 символов")
    .max(128)
    .regex(/\p{L}/u, "Добавьте букву")
    .regex(/[0-9]/, "Добавьте цифру"),
});
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export const interestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(
      /^[\p{L}\p{N} +#.&()/'-]+$/u,
      "Используйте буквы, цифры и обычные знаки",
    ),
  categoryId: z.string().min(1).max(64),
});
// Небольшой автоматический фильтр; спорные случаи рассматриваются по жалобам.
const prohibited = [
  "хуй",
  "хуе",
  "хуё",
  "пизд",
  "бляд",
  "блят",
  "ебат",
  "ёбат",
  "fuck",
  "nigger",
];
export function normalizedInterest(value: string) {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .trim()
    .replace(/\s+/g, " ");
  const compact = normalized.replace(/[\s_-]/g, "");
  const aliases: Record<string, string> = {
    cs2: "cs2",
    counterstrike2: "cs2",
    кс2: "cs2",
    ксго: "cs2",
    csgo: "cs2",
    counterstrikeglobaloffensive: "cs2",
    dota2: "dota 2",
    дота2: "dota 2",
    basketball: "баскетбол",
    js: "javascript",
    пайтон: "python",
    питон: "python",
  };
  return aliases[compact] ?? normalized;
}
export function isProhibited(value: string) {
  const text = value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/[^\p{L}]/gu, "");
  return prohibited.some((word) => text.includes(word));
}
