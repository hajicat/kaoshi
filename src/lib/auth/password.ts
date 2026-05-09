import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

const ITERATIONS = 100_000;
const KEY_LEN = 32;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = pbkdf2(sha256, new TextEncoder().encode(password), salt, {
    c: ITERATIONS,
    dkLen: KEY_LEN,
  });
  return `pbkdf2:${ITERATIONS}:${toHex(salt)}:${toHex(key)}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  // Support legacy bcrypt hashes (start with $2)
  if (stored.startsWith("$2")) {
    const { compare } = await import("bcryptjs");
    return compare(password, stored);
  }

  // PBKDF2 format: pbkdf2:iterations:salt_hex:hash_hex
  const parts = stored.split(":");
  if (parts[0] !== "pbkdf2" || parts.length !== 4) return false;

  const iterations = parseInt(parts[1], 10);
  const salt = fromHex(parts[2]);
  const expected = fromHex(parts[3]);

  const key = pbkdf2(sha256, new TextEncoder().encode(password), salt, {
    c: iterations,
    dkLen: expected.length,
  });

  // Constant-time comparison
  if (key.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < key.length; i++) {
    diff |= key[i] ^ expected[i];
  }
  return diff === 0;
}
