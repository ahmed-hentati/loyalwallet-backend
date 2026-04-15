const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/pool');

// ─── POST /api/auth/register ──────────────────────────────
// Inscription d'un nouveau restaurateur
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email et password sont requis' });
    }

    // Vérifier si l'email existe déjà
    const existing = await pool.query(
      'SELECT id FROM restaurants WHERE email = $1',
      [email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email déjà utilisé' });
    }

    // Hasher le mot de passe
    const password_hash = await bcrypt.hash(password, 12);

    // Créer le restaurant
    const result = await pool.query(
      `INSERT INTO restaurants (name, email, password_hash, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, plan, created_at`,
      [name, email, password_hash, phone || null]
    );

    const restaurant = result.rows[0];

    // Générer le JWT
    const token = jwt.sign(
      { id: restaurant.id, email: restaurant.email, plan: restaurant.plan },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({ token, restaurant });

  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/login ─────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'email et password sont requis' });
    }

    const result = await pool.query(
      'SELECT * FROM restaurants WHERE email = $1',
      [email]
    );

    const restaurant = result.rows[0];

    if (!restaurant) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const valid = await bcrypt.compare(password, restaurant.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const token = jwt.sign(
      { id: restaurant.id, email: restaurant.email, plan: restaurant.plan },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    const { password_hash, ...restaurantData } = restaurant;

    res.json({ token, restaurant: restaurantData });

  } catch (err) {
    next(err);
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────
const { authMiddleware } = require('../middleware/auth');

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, phone, logo_url, plan, created_at FROM restaurants WHERE id = $1',
      [req.restaurant.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
