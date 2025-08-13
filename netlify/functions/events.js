/*
  events.js (Netlify Function)

  This serverless function handles CRUD operations for calendar events.
  Events are stored in a PostgreSQL database accessible via Neon. Each
  user has their own event collection keyed by date. Clients can fetch
  all events for a user (GET) or persist the entire events map for a
  user (POST). See auth.js for user management.

  Environment: The function uses the @netlify/neon library, which
  automatically reads the connection string from the `NETLIFY_DATABASE_URL`
  environment variable (or NETLIFY_DATABASE_URL_UNPOOLED if defined).

  Database schema (PostgreSQL):

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      title TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      all_day BOOLEAN NOT NULL,
      color TEXT DEFAULT '#3EA6FF'
    );

  When updating events for a user via POST, the function deletes all
  existing events for that user and inserts the provided ones. This
  simplifies synchronisation but could be optimised later (e.g. upsert).

*/

import { neon } from '@netlify/neon';

const sql = neon();

export async function handler(event) {
  const method = event.httpMethod;
  try {
    if (method === 'GET') {
      // Fetch events for a user: ?user=username
      const user = event.queryStringParameters && event.queryStringParameters.user;
      if (!user) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing user parameter' }) };
      }
      // Get user id
      const userRows = await sql`SELECT id FROM users WHERE username = ${user}`;
      if (userRows.length === 0) {
        // No events if user does not exist
        return { statusCode: 200, body: JSON.stringify({ events: {} }) };
      }
      const userId = userRows[0].id;
      const eventRows = await sql`SELECT date, title, start_time, end_time, all_day, color FROM events WHERE user_id = ${userId}`;
      const eventsMap = {};
      eventRows.forEach(row => {
        const dateKey = row.date.toISOString().split('T')[0];
        if (!eventsMap[dateKey]) eventsMap[dateKey] = [];
        eventsMap[dateKey].push({
          title: row.title,
          start: row.start_time,
          end: row.end_time,
          allDay: row.all_day,
          color: row.color
        });
      });
      return { statusCode: 200, body: JSON.stringify({ events: eventsMap }) };
    }
    if (method === 'POST') {
      // Persist events for a user
      const data = JSON.parse(event.body || '{}');
      const user = data.user;
      const events = data.events;
      if (!user || typeof events !== 'object') {
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid payload' }) };
      }
      // Get or create user
      let userId;
      const userRows = await sql`SELECT id FROM users WHERE username = ${user}`;
      if (userRows.length === 0) {
        // Create user with a blank password if they do not exist. In a
        // production system the user should already exist and have a
        // password set via auth.js.
        const insertRows = await sql`INSERT INTO users (username, password) VALUES (${user}, '') RETURNING id`;
        userId = insertRows[0].id;
      } else {
        userId = userRows[0].id;
      }
      // Remove existing events for this user
      await sql`DELETE FROM events WHERE user_id = ${userId}`;
      // Insert new events
      for (const [dateKey, list] of Object.entries(events)) {
        for (const ev of list) {
          const { title, start, end, allDay, color } = ev;
          await sql`INSERT INTO events (user_id, date, title, start_time, end_time, all_day, color) VALUES (${userId}, ${dateKey}, ${title}, ${start}, ${end}, ${allDay}, ${color || '#3EA6FF'})`;
        }
      }
      return { statusCode: 200, body: JSON.stringify({ status: 'saved' }) };
    }
    // Unsupported method
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  } catch (err) {
    console.error('Error in events function', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}