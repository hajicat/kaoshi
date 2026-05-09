import { createClient } from "@libsql/client/web";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getDb() {
  if (!_db) {
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}

// Lazy proxy: `db` is accessed as a plain object but delegates to getDb()
export const db = new Proxy(Object.create(null), {
  get(target, prop, receiver) {
    const real = getDb();
    const val = Reflect.get(real, prop, receiver);
    if (typeof val === "function") {
      return val.bind(real);
    }
    return val;
  },
}) as ReturnType<typeof drizzle<typeof schema>>;
