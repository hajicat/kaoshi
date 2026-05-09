import { z } from "zod";

export const LoginSchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

export const ChangePasswordSchema = z.object({
  oldPassword: z.string().min(1, "请输入旧密码"),
  newPassword: z.string().min(6, "新密码至少 6 位"),
});

export const CreateUserSchema = z.object({
  username: z.string().min(2, "用户名至少 2 位"),
  nickname: z.string().min(1, "请输入昵称"),
  password: z.string().min(6, "密码至少 6 位"),
  role: z.enum(["admin", "user"]),
});

export const UpdateUserSchema = z.object({
  nickname: z.string().min(1).optional(),
  status: z.enum(["active", "disabled"]).optional(),
  role: z.enum(["admin", "user"]).optional(),
});
