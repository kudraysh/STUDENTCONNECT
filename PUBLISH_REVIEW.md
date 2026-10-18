# Что подготовлено к публикации — 0.9.0

Сейчас это готовый к просмотру исходный код. Запись в GitHub и создание Render-сервиса ещё НЕ выполнены: автоматическая проверка попросила явное подтверждение назначения и содержимого.

## Предлагаемое действие

- Репозиторий: https://github.com/kudraysh/STUDENTCONNECT — уже существующий публичный репозиторий пользователя.
- Ветка: main, обычный fast-forward-коммит поверх a6257dabf66fa0b63246380d27724d5833b98ad2. Force push и переписывание истории не планируются.
- Загрузить все исходники/тесты/инструкции из этого архива. Старый main содержит корневые файлы версии 0.4.0, без apps/.
- Удалить только отслеживаемый .env из актуального дерева репозитория. Локальные .env на компьютере не трогаются; старые коммиты остаются в истории. Настоящие .env/ключи/база не входят в архив и не будут загружены.
- Включить .env.example с демонстрационными локальными значениями и deploy/production.env.example с явно обозначенными заполнителями.
- Далее создать Node Web Service studentconnect на Render Free во Frankfurt в рабочем пространстве My Workspace (tea-dbaclp49v7es7380ostg), с настройками render.yaml. Платные тарифы не разрешены.
- Neon-проект уже создан: studentconnect, floral-cell-35740634, PostgreSQL 17, AWS Frankfurt, организация kvdryash на Free. Это отдельная пустая база; локальные аккаунты не переносились.
- Для полноценного публичного запуска ещё нужны подтверждённый отправитель Brevo и API key, который вводится только в секреты Render. Без них реальная почта и окончательная публичная проверка не подтверждены.

## Проверки

119 автоматических проверок, TypeScript, сборка и отдельный тест настоящего собранного production-сервера прошли. Письма тестировались через поддельный HTTP-клиент; реальных писем не отправлено. Настройки Render/Neon/Brevo описаны в DEPLOY.md. Ограничения и выполненные проверки — TEST_RESULTS.md.

## Состав исходников

Ниже перечислены файлы проекта (дополнительно в архиве присутствует сама эта сводка PUBLISH_REVIEW.md):

- `.env.example`
- `.gitignore`
- `.node-version`
- `DEPLOY.md`
- `README.md`
- `TESTING.md`
- `TEST_RESULTS.md`
- `UPDATE.md`
- `apps/api/.env.example`
- `apps/api/package.json`
- `apps/api/prisma/migrations/20261016180000_init/migration.sql`
- `apps/api/prisma/migrations/20261016200000_accounts/migration.sql`
- `apps/api/prisma/migrations/20261016210000_events/migration.sql`
- `apps/api/prisma/migrations/20261018110000_chat/migration.sql`
- `apps/api/prisma/migrations/20261018143000_event_close/migration.sql`
- `apps/api/prisma/migrations/20261018150000_notifications/migration.sql`
- `apps/api/prisma/migrations/20261018160000_people_feed/migration.sql`
- `apps/api/prisma/migrations/20261018170000_feedback/migration.sql`
- `apps/api/prisma/migrations/migration_lock.toml`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/seed.ts`
- `apps/api/scripts/feedback-list.ts`
- `apps/api/scripts/smoke-production.ts`
- `apps/api/src/accounts.test.ts`
- `apps/api/src/accounts.ts`
- `apps/api/src/app.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/chat.test.ts`
- `apps/api/src/chat.ts`
- `apps/api/src/chatSocket.ts`
- `apps/api/src/config.ts`
- `apps/api/src/deployment.test.ts`
- `apps/api/src/errors.ts`
- `apps/api/src/events.test.ts`
- `apps/api/src/events.ts`
- `apps/api/src/feed.test.ts`
- `apps/api/src/feed.ts`
- `apps/api/src/feedback.test.ts`
- `apps/api/src/feedback.ts`
- `apps/api/src/mail.ts`
- `apps/api/src/migrations.test.ts`
- `apps/api/src/notifications.test.ts`
- `apps/api/src/notifications.ts`
- `apps/api/src/people.ts`
- `apps/api/src/security.ts`
- `apps/api/src/server.ts`
- `apps/api/src/settings.ts`
- `apps/api/src/validation.ts`
- `apps/api/src/web.ts`
- `apps/api/tsconfig.json`
- `apps/web/.env.example`
- `apps/web/index.html`
- `apps/web/package.json`
- `apps/web/src/AppErrorBoundary.tsx`
- `apps/web/src/Auth.tsx`
- `apps/web/src/AuthPages.tsx`
- `apps/web/src/ChatContext.tsx`
- `apps/web/src/ChatPhone.tsx`
- `apps/web/src/CreateEventPage.tsx`
- `apps/web/src/EventDetailPage.tsx`
- `apps/web/src/EventNotices.tsx`
- `apps/web/src/EventsPage.tsx`
- `apps/web/src/FeedbackPage.tsx`
- `apps/web/src/Foundation.tsx`
- `apps/web/src/InterestsPicker.tsx`
- `apps/web/src/MessagesPage.tsx`
- `apps/web/src/Notifications.tsx`
- `apps/web/src/PeopleFeedPage.tsx`
- `apps/web/src/PeoplePage.tsx`
- `apps/web/src/ProfileFields.tsx`
- `apps/web/src/ProfilePage.tsx`
- `apps/web/src/StartChatButton.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/browserSafety.test.ts`
- `apps/web/src/chatTypes.ts`
- `apps/web/src/clientIds.ts`
- `apps/web/src/eventsApi.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/preferences.ts`
- `apps/web/src/style.css`
- `apps/web/src/vite-env.d.ts`
- `apps/web/tsconfig.json`
- `apps/web/vite.config.ts`
- `compose.yaml`
- `deploy/production.env.example`
- `package-lock.json`
- `package.json`
- `render.yaml`
