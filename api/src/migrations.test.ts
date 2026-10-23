import { test } from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
const run = promisify(execFile);
const require = createRequire(import.meta.url);
test(
  "Prisma CLI: deploy дважды и повторяемый seed на изолированной БД",
  { timeout: 120000 },
  async (t) => {
    const pg = await PGlite.create();
    const socket = new PGLiteSocketServer({
      db: pg,
      port: 0,
      host: "127.0.0.1",
      maxConnections: 4,
    });
    t.after(async () => {
      await socket.stop();
      await pg.close();
    });
    await socket.start();
    const env = {
      ...process.env,
      DATABASE_URL: `postgresql://postgres:postgres@${socket.getServerConn()}/postgres?sslmode=disable&connection_limit=1`,
    };
    const cwd = fileURLToPath(new URL("..", import.meta.url));
    const schema = fileURLToPath(
      new URL("../prisma/schema.prisma", import.meta.url),
    );
    for (let i = 0; i < 2; i++) {
      const result = await run(
        process.execPath,
        [
          require.resolve("prisma/build/index.js"),
          "migrate",
          "deploy",
          "--schema",
          schema,
        ],
        { env, cwd, timeout: 30000 },
      );
      assert.match(
        result.stdout,
        i === 0 ? /applied/ : /No pending migrations/,
      );
    }
    for (let i = 0; i < 2; i++) {
      // WASM-бэкенд сохраняет prepared statements между TCP-клиентами.
      await pg.exec("DEALLOCATE ALL");
      await run(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(new URL("../prisma/seed.ts", import.meta.url)),
        ],
        { env, cwd, timeout: 30000 },
      );
    }
    const { rows } = await pg.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "Category"',
    );
    assert.equal(rows[0].count, 9);
    const { rows: interests } = await pg.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "Interest"',
    );
    assert.equal(interests[0].count, 18);
  },
);
