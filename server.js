const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT.startsWith('{')) {
  // If it starts with '{', assume it's the JSON content
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // Otherwise, assume it's a file path
  serviceAccount = JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT, 'utf8'));
}

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Set up PostgreSQL connection
const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Middleware to verify Firebase token
const verifyToken = async (req, res, next) => {
  const idToken = req.headers.authorization;
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(403).send('Unauthorized');
  }
};

// Route to check if user completed journey today
app.get('/api/journey/check', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const today = new Date().toLocaleDateString('en-CA');

  try {
    const result = await pool.query(
      'SELECT last_completed_date FROM user_journeys WHERE user_id = $1',
      [userId]
    );

    let completed = false;
    if (result.rows.length > 0) {
      const lastCompletedDate = new Date(result.rows[0].last_completed_date).toLocaleDateString('en-CA');
      completed = lastCompletedDate === today;
    }
    res.json({ completed });
  } catch (error) {
    console.error('Error in /api/journey/check:', error);
    res.status(500).json({ message: error.message, stack: error.stack });
  }
});

// Route to save score
app.post('/api/scores', verifyToken, async (req, res) => {
  const { score } = req.body;
  const userId = req.user.uid;

  try {
    const result = await pool.query(
      'INSERT INTO scores (user_id, score) VALUES ($1, $2) RETURNING *',
      [userId, score]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error in /api/scores:', error);
    res.status(500).json({ message: error.message, stack: error.stack });
  }
});

// Route to get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM scores ORDER BY score DESC LIMIT 10');
    res.json(result.rows);
  } catch (error) {
    console.error('Error in /api/leaderboard:', error);
    res.status(500).json({ message: error.message, stack: error.stack });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
