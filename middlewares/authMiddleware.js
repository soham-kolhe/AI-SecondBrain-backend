const jwt = require("jsonwebtoken");

const authenticate = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "") || req.query.token;
  if (!token) {
    req.user = null; // Mark as Guest
    return next();
  }
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token expired or invalid. Please login again.", code: "TOKEN_INVALID" });
  }
};

module.exports = authenticate;
