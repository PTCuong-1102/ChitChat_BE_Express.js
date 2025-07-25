import jwt from "jsonwebtoken";

export const generateToken = (userId, res) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  // SỬA LỖI: Fix cookie configuration for production cross-domain
  res.cookie("jwt", token, {
    maxAge: 7 * 24 * 60 * 60 * 1000, // MS
    httpOnly: true, // prevent XSS attacks cross-site scripting attacks
    sameSite: process.env.NODE_ENV === "production" ? "none" : "strict", // Fix for cross-domain
    secure: process.env.NODE_ENV === "production", // Required when sameSite=none
    domain: process.env.NODE_ENV === "production" ? undefined : undefined, // Let browser handle domain
  });

  console.log("Generated token for user:", userId, "in environment:", process.env.NODE_ENV);
  return token;
};
