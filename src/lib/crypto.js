import crypto from "crypto";

// Thuật toán mã hóa, aes-256-gcm là một lựa chọn hiện đại và an toàn
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // Initialization Vector length for GCM
const AUTH_TAG_LENGTH = 16; // Auth Tag length for GCM

// Lấy khóa bí mật từ biến môi trường (lazy loading)
const getSecretKey = () => {
  const SECRET_KEY_HEX = process.env.ENCRYPTION_SECRET_KEY;
  if (!SECRET_KEY_HEX || SECRET_KEY_HEX.length !== 64) {
    throw new Error(
      "ENCRYPTION_SECRET_KEY is not defined in environment variables or is not a 64-character hex string."
    );
  }
  return Buffer.from(SECRET_KEY_HEX, "hex");
};

/**
 * Mã hóa một chuỗi văn bản.
 * @param {string} text - Chuỗi cần mã hóa.
 * @returns {string} - Chuỗi đã được mã hóa, bao gồm cả iv và authTag.
 */
export const encrypt = (text) => {
  try {
    const SECRET_KEY = getSecretKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
    
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Kết hợp iv, authTag, và dữ liệu mã hóa thành một chuỗi duy nhất để lưu trữ
    return Buffer.concat([iv, authTag, encrypted]).toString('hex');
  } catch (error) {
    console.error("Encryption failed:", error);
    throw new Error("Encryption failed: " + error.message);
  }
};

/**
 * Giải mã một chuỗi đã được mã hóa.
 * @param {string} encryptedHex - Chuỗi hex đã được mã hóa.
 * @returns {string} - Chuỗi văn bản gốc.
 */
export const decrypt = (encryptedHex) => {
  try {
    const SECRET_KEY = getSecretKey();
    const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
    
    // Tách iv, authTag, và dữ liệu mã hóa từ buffer
    const iv = encryptedBuffer.subarray(0, IV_LENGTH);
    const authTag = encryptedBuffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encryptedData = encryptedBuffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

    return decrypted.toString('utf8');
  } catch (error) {
    console.error("Decryption failed:", error);
    throw new Error("Decryption failed: " + error.message);
  }
};