const jwt = require("jsonwebtoken");

/**
 * Strict middleware for Assessment-related commands.
 * Unlike the soft `authenticate` middleware, this BLOCKS access entirely
 * if the user is not authenticated instead of allowing guest access.
 */
const assessmentAuth = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({
      error: "Login required to access Assessment Engine.",
      code: "AUTH_REQUIRED_FOR_TEST",
    });
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    return res.status(401).json({
      error: "Login required to access Assessment Engine.",
      code: "AUTH_REQUIRED_FOR_TEST",
    });
  }
};

module.exports = assessmentAuth;
