import nodemailer from "nodemailer";
export type VerificationMail = { to: string; url: string };
export type Mailer = {
  mode: "console" | "smtp" | "brevo" | "manual";
  sendVerification: (mail: VerificationMail) => Promise<void>;
};
export function createMailer(options: {
  MAIL_MODE: "console" | "smtp" | "brevo" | "manual";
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  MAIL_FROM: string;
  BREVO_API_KEY?: string;
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
}, dependencies: {fetch?: typeof fetch} = {}): Mailer {
  // Закрытое демо: письмо и токен не отправляются и не попадают в логи.
  if (options.MAIL_MODE === "manual") return {mode:"manual", async sendVerification() {}};
  if (options.MAIL_MODE === "console")
    return {
      mode: "console",
      async sendVerification({ to, url }) {
        // Только локальная разработка. Токен не сохраняется в БД в открытом виде.
        console.log(
          `\n[ТЕСТОВАЯ ПОЧТА — реальное письмо НЕ отправлено]\nКому: ${to}\nПодтвердить: ${url}\nСсылка действует 24 часа. Не публикуйте её.\n`,
        );
      },
    };
  if(options.MAIL_MODE === "brevo") {
    if(!options.BREVO_API_KEY || !options.BREVO_SENDER_EMAIL)
      throw new Error("Для Brevo нужны API-ключ и подтверждённый отправитель");
    const send=dependencies.fetch ?? fetch;
    return {mode:"brevo",async sendVerification({to,url}){
      try {
        const response=await send("https://api.brevo.com/v3/smtp/email",{
          method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
          headers:{"api-key":options.BREVO_API_KEY!,"Content-Type":"application/json","Accept":"application/json"},
          body:JSON.stringify({
            sender:{name:options.BREVO_SENDER_NAME ?? "StudentConnect",email:options.BREVO_SENDER_EMAIL},
            to:[{email:to}],subject:"Подтвердите почту StudentConnect",
            textContent:`Подтвердите электронную почту StudentConnect:\n${url}\n\nСсылка действует 24 часа. Если вы не регистрировались, проигнорируйте письмо.`,
          }),
        });
        if(!response.ok)throw new Error("provider-rejected");
        // Ответ провайдера может содержать адреса: не выводим его в логи.
        await response.body?.cancel();
      }catch{throw new Error("Не удалось отправить письмо через Brevo");}
    }};
  }
  const transport = nodemailer.createTransport({
    host: options.SMTP_HOST,
    port: options.SMTP_PORT,
    secure: options.SMTP_PORT === 465,
    requireTLS: options.SMTP_PORT !== 465,
    auth: options.SMTP_USER
      ? { user: options.SMTP_USER, pass: options.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return {
    mode: "smtp",
    async sendVerification({ to, url }) {
      await transport.sendMail({
        from: options.MAIL_FROM,
        to,
        subject: "Подтвердите почту StudentConnect",
        text: `Подтвердите электронную почту StudentConnect:\n${url}\n\nСсылка действует 24 часа. Если вы не регистрировались, проигнорируйте письмо.`,
      });
    },
  };
}
