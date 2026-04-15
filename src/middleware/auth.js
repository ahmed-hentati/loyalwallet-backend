const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou invalide' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.restaurant = decoded; // { id, email, plan }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expiré ou invalide' });
  }
}

// Middleware pour vérifier le plan Pro
function requirePro(req, res, next) {
  if (req.restaurant.plan !== 'pro') {
    return res.status(403).json({
      error: 'Fonctionnalité réservée au plan Pro',
      upgrade_url: '/pricing'
    });
  }
  next();
}

module.exports = { authMiddleware, requirePro };
