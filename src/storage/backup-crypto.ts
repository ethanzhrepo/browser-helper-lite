/**
 * Password protection for backup files.
 *
 * The text is encrypted with AES-256-GCM. The key is derived from the password
 * with PBKDF2-HMAC-SHA-256 and a random salt. The password is never stored:
 * without it the file cannot be opened.
 */
export const KDF_ITERATIONS = 600_000;
/** A file may name its own count; these bounds keep a crafted one from being too weak to mean anything or freezing the page. */
export const MIN_KDF_ITERATIONS = 100_000;
export const MAX_KDF_ITERATIONS = 10_000_000;
export const MIN_PASSWORD_LENGTH = 8;

const SALT_BYTES = 16;
const IV_BYTES = 12;
/** Ties the ciphertext to this kind of file. */
const CONTEXT = new TextEncoder().encode('browser-helper-lite backup v1');

export interface Sealed {
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  /** Base64. */
  salt: string;
  iv: string;
  data: string;
}

/** The password is wrong, or the file was changed after it was written: AES-GCM cannot tell the two apart. */
export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password, or the file is damaged.');
    this.name = 'WrongPasswordError';
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // In pieces: a large file would overflow the argument list.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw new Error('Damaged backup file.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  // The same password typed on another keyboard or system must give the same bytes.
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function seal(text: string, password: string, iterations = KDF_ITERATIONS): Promise<Sealed> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, iterations);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: CONTEXT }, key, new TextEncoder().encode(text));
  return { cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

/** Throws WrongPasswordError when the password does not open the file. */
export async function unseal(sealed: Sealed, password: string): Promise<string> {
  if (sealed.cipher !== 'AES-256-GCM' || sealed.kdf !== 'PBKDF2-SHA256') throw new Error('Unknown backup encryption.');
  if (!Number.isInteger(sealed.iterations) || sealed.iterations < MIN_KDF_ITERATIONS || sealed.iterations > MAX_KDF_ITERATIONS) {
    throw new Error('Damaged backup file.');
  }
  const salt = fromBase64(sealed.salt);
  const iv = fromBase64(sealed.iv);
  if (salt.length < SALT_BYTES || iv.length !== IV_BYTES) throw new Error('Damaged backup file.');
  const key = await deriveKey(password, salt, sealed.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: CONTEXT }, key, fromBase64(sealed.data));
  } catch {
    throw new WrongPasswordError();
  }
  return new TextDecoder().decode(plain);
}
