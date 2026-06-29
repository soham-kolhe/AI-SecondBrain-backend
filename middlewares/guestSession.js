const crypto = require("crypto");

/**
 * Ensures every request — authenticated or not — has a stable ownerId.
 * Authenticated users use their real user ID. Guests get a random UUID
 * stored in an httpOnly cookie, so concurrent guests never collide on IP.
 */
const guestSession = (req, res, next) => {
  if (req.user) {
    req.ownerId = req.user.id;
    return next();
  }

  let guestId = req.cookies?.guestId;
  if (!guestId) {
    guestId = crypto.randomUUID();
    res.cookie("guestId", guestId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    });
  }
  req.ownerId = `guest:${guestId}`;
  next();
};

module.exports = guestSession;
