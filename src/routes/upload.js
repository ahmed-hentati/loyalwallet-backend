const express    = require('express');
const router     = express.Router();
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const { authMiddleware } = require('../middleware/auth');
const { pool } = require('../db/pool');

// ── Config Cloudinary ─────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Multer — stockage en mémoire (pas sur disque) ─────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Seules les images sont acceptées'));
    }
    cb(null, true);
  },
});

// ── POST /api/upload/logo ─────────────────────────────────
// Upload logo restaurant → Cloudinary → retourne l'URL
router.post('/logo', authMiddleware, upload.single('logo'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }

    const restaurantId = req.restaurant.id;

    // Upload vers Cloudinary
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder:         'loyalwallet/logos',
          public_id:      `restaurant_${restaurantId}`,
          overwrite:      true,
          transformation: [
            { width: 200, height: 200, crop: 'fill', gravity: 'center' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    // Sauvegarder l'URL dans la table restaurants
    await pool.query(
      'UPDATE restaurants SET logo_url = $1 WHERE id = $2',
      [result.secure_url, restaurantId]
    );

    res.json({
      success: true,
      logo_url: result.secure_url,
    });

  } catch (err) {
    next(err);
  }
});

// ── POST /api/upload/card-logo/:cardId ────────────────────
// Upload logo spécifique à une carte
router.post('/card-logo/:cardId', authMiddleware, upload.single('logo'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }

    const { cardId } = req.params;
    const restaurantId = req.restaurant.id;

    // Vérifier que la carte appartient au restaurant
    const card = await pool.query(
      'SELECT id FROM loyalty_cards WHERE id = $1 AND restaurant_id = $2',
      [cardId, restaurantId]
    );

    if (card.rows.length === 0) {
      return res.status(404).json({ error: 'Carte introuvable' });
    }

    // Upload vers Cloudinary
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder:         'loyalwallet/card-logos',
          public_id:      `card_${cardId}`,
          overwrite:      true,
          transformation: [
            { width: 200, height: 200, crop: 'fill', gravity: 'center' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    // Sauvegarder l'URL dans loyalty_cards
    await pool.query(
      'UPDATE loyalty_cards SET logo_url = $1 WHERE id = $2',
      [result.secure_url, cardId]
    );

    res.json({
      success: true,
      logo_url: result.secure_url,
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
