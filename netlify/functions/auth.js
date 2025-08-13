/*
  auth.js (Netlify Function)

  Provides simple authentication endpoints for the adaptive dashboard.
  Users can sign up, log in and change passwords. Credentials are
  stored in a Neon PostgreSQL database accessed via @netlify/neon.
  Passwords are stored in plain text for demonstration purposes and
  should be hashed in a production system using bcrypt or another
  secure algorithm. This API is not intended for production use.

  Payload schema (POST only):

    {
      "action": "signup" | "login" | "changePassword",
      "username": "user",
      "password": "secret",
      "newPassword": "newsecret" (only for changePassword)
    }

  Responses:
    Success: { status: 'ok' }
    Error:   { error: 'message' }

  NOTE: To enable this API, set USE_REMOTE_STORAGE = true in script.js
  and deploy with NETLIFY_DATABASE_URL environment variable set to
  your Neon connection string. For real security, implement hashed
  passwords and session tokens.
*/

import { neon } from '@netlify/neon';

const sql = neon();

export async function handler(event) {
  // Only support POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const { action, username, password, newPassword } = payload;
  if (!action || !username) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing parameters' }) };
  }
  try {
    if (action === 'signup') {
      // Check if user already exists
      const existing = await sql`SELECT id FROM users WHERE username = ${username}`;
      if (existing.length > 0) {
        return { statusCode: 400, body: JSON.stringify({ error: 'User already exists' }) };
      }
      // Create user with provided password
      await sql`INSERT INTO users (username, password) VALUES (${username}, ${password})`;
      return { statusCode: 200, body: JSON.stringify({ status: 'ok' }) };
    }
    if (action === 'login') {
      // Verify credentials
      const userRows = await sql`SELECT id, password FROM users WHERE username = ${username}`;
      if (userRows.length === 0 || userRows[0].password !== password) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Invalid credentials' }) };
      }
      return { statusCode: 200, body: JSON.stringify({ status: 'ok' }) };
    }
    if (action === 'changePassword') {
      if (!password || !newPassword) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing password parameters' }) };
      }
      // Verify current password
      const userRows = await sql`SELECT id, password FROM users WHERE username = ${username}`;
      if (userRows.length === 0 || userRows[0].password !== password) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Invalid credentials' }) };
      }
      // Update password
      await sql`UPDATE users SET password = ${newPassword} WHERE id = ${userRows[0].id}`;
      return { statusCode: 200, body: JSON.stringify({ status: 'ok' }) };
    }
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  } catch (err) {
    console.error('Auth error', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}