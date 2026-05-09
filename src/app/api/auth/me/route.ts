import { requireUser } from "@/lib/auth/permissions";
import { getUserFromDb } from "@/lib/auth/permissions";
import { jsonOk, handleApiError } from "@/lib/api-helpers";

export async function GET() {
  try {
    const session = await requireUser();
    const user = await getUserFromDb(session.userId);

    if (!user) {
      return jsonOk({ user: null });
    }

    return jsonOk({
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
