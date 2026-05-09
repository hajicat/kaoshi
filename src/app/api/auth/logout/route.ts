import { clearSessionCookie } from "@/lib/auth/session";
import { jsonOk } from "@/lib/api-helpers";

export async function POST() {
  await clearSessionCookie();
  return jsonOk({ message: "已退出登录" });
}
