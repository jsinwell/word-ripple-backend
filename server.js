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

// Route to save a new score
app.post('/api/scores', verifyToken, async (req, res) => {
  const { score } = req.body;
  const userId = req.user.uid;
  const displayName = req.user.name || req.user.email;

  console.log('Processing score:', score, 'for user:', userId);

  try {
    // First get the user's current high score
    const currentScoreResult = await pool.query(
      'SELECT score FROM public.scores WHERE user_id = $1',
      [userId]
    );

    const currentHighScore = currentScoreResult.rows[0]?.score || 0;

    // Only insert or update if the new score is higher
    if (score > currentHighScore) {
      const result = await pool.query(
        'INSERT INTO public.scores (user_id, score, display_name) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET score = EXCLUDED.score, timestamp = CURRENT_TIMESTAMP RETURNING *',
        [userId, score, displayName]
      );
      console.log('Update result:', result.rows[0]);
      res.status(201).json(result.rows[0]);
    } else {
      res.status(200).json({ message: 'Score not updated as it\'s not higher than the current high score.' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Route to get top scores
app.get('/api/leaderboard', async (req, res) => {
  try {
    console.log('Executing leaderboard query...');
    const result = await pool.query(`
      SELECT NOW()
    `);
    console.log('Leaderboard query result:', result.rows);
    res.json(result.rows);
  } catch (error) {
    console.error('Error in /api/leaderboard:', error);
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json(result.rows);
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ message: error.message });
  }
});


/// Route to check if user completed journey today
app.get('/api/journey/check', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const today = new Date().toLocaleDateString('en-CA'); 

  try {
    const result = await pool.query(
      'SELECT last_completed_date FROM public.user_journeys WHERE user_id = $1',
      [userId]
    );

    // Compare local time to what is stored in database. Allows journey to reset at local midnight
    let completed = false;
    if (result.rows.length > 0) {
      const lastCompletedDate = new Date(result.rows[0].last_completed_date).toLocaleDateString('en-CA');
      completed = lastCompletedDate === today; // Only return true if the last completed date is today
    }
    res.json({ completed });
  } catch (error) {
    console.error('Error in /api/journey/check:', error);
    res.status(500).json({ message: error.message, stack: error.stack });
  }
});

// Route to mark when daily journey was completed in local time
app.post('/api/journey/complete', verifyToken, async (req, res) => {
  const userId = req.user.uid;
  const today = new Date().toLocaleDateString('en-CA');

  try {
    await pool.query(
      'INSERT INTO public.user_journeys (user_id, last_completed_date) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET last_completed_date = EXCLUDED.last_completed_date',
      [userId, today]
    );
    res.status(201).json({ message: 'Journey completion recorded' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));