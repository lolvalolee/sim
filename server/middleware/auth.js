// server/middleware/auth.js
const jwt = require('jsonwebtoken');
const db  = require('../db');

function requireAuth(roles = []) {
  return (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token' });
    }
    const token = auth.slice(7);
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      // Refresh user from DB to check active status
      const user = db.prepare('SELECT id,email,name,role,active FROM users WHERE id=?')
                     .get(payload.id);
      if (!user || !user.active) {
        return res.status(401).json({ error: 'Account inactive or not found' });
      }
      if (roles.length && !roles.includes(user.role)) {
        return res.status(403).json({ error: 'Access denied' });
      }
      req.user = user;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
}

module.exports = { requireAuth };
