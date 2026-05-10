const jwt = require("jsonwebtoken");

const authenticate = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  if (!token) {
    req.user = null; // Mark as Guest
    return next();
  }
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    req.user = null; // Invalid token = Guest
    next();
  }
};

module.exports = authenticate;
