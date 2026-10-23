import { z } from "zod";
const schema=z.object({
  PORT:z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN:z.string().url().default("http://localhost:5173"),
  DATABASE_URL:z.string().startsWith("postgresql://"),
  NODE_ENV:z.enum(["development","test","production"]).default("development"),
  SERVE_WEB:z.enum(["0","1"]).default("0"),
  COOKIE_SAME_SITE:z.enum(["lax","none","strict"]).default("lax"),
  TRUST_PROXY:z.enum(["0","1"]).default("0"),
  MAIL_MODE:z.enum(["console","smtp","brevo"]).default("console"),
  SMTP_HOST:z.string().optional(),
  SMTP_PORT:z.coerce.number().int().positive().default(587),
  SMTP_USER:z.string().optional(),
  SMTP_PASSWORD:z.string().optional(),
  MAIL_FROM:z.string().default("StudentConnect <noreply@studentconnect.local>"),
  BREVO_API_KEY:z.string().trim().min(1).optional(),
  BREVO_SENDER_EMAIL:z.string().email().optional(),
  BREVO_SENDER_NAME:z.string().trim().min(1).max(80).default("StudentConnect"),
});
export function parseSettings(env:Record<string,string|undefined>){
  const effective={...env,WEB_ORIGIN:env.WEB_ORIGIN?.trim() || (env.NODE_ENV==="production" && env.SERVE_WEB==="1" ? env.RENDER_EXTERNAL_URL : undefined)};
  const parsed=schema.safeParse(effective);
  if(!parsed.success)throw new Error(`Проверь переменные окружения: ${[...new Set(parsed.error.issues.map(i=>i.path.join(".")))].join(", ")}`);
  const config=parsed.data;
  const web=new URL(config.WEB_ORIGIN);
  if(!["http:","https:"].includes(web.protocol)||web.username||web.password||web.search||web.hash||web.pathname!=="/")
    throw new Error("WEB_ORIGIN должен содержать только адрес сайта без пути, параметров и учётных данных");
  config.WEB_ORIGIN=web.origin;
  if(config.NODE_ENV==="production"){
    if(web.protocol!=="https:")throw new Error("В production WEB_ORIGIN должен использовать HTTPS");
    if(config.MAIL_MODE==="console")throw new Error("В production требуется настоящая почта: MAIL_MODE=smtp или brevo");
  }
  if(config.MAIL_MODE==="smtp" && !config.SMTP_HOST)throw new Error("Укажи SMTP_HOST");
  if(config.MAIL_MODE==="brevo" && (!config.BREVO_API_KEY||!config.BREVO_SENDER_EMAIL))
    throw new Error("Для Brevo укажи BREVO_API_KEY и подтверждённый BREVO_SENDER_EMAIL");
  if(config.COOKIE_SAME_SITE==="none" && config.NODE_ENV!=="production")throw new Error("SameSite=None требует HTTPS production");
  return config;
}
