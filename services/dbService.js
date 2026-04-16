'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'app.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE,
      password_hash TEXT,
      github_id   TEXT UNIQUE,
      github_login TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS llm_configs (
      user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      endpoint_url    TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
      api_key_encrypted TEXT NOT NULL,
      model_name      TEXT NOT NULL DEFAULT 'gpt-4o-mini',
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quiz_sessions (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      certification_id TEXT NOT NULL,
      mode            TEXT NOT NULL,
      domain_filter   TEXT,
      started_at      TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS session_answers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
      question_id     TEXT NOT NULL,
      domain_id       TEXT NOT NULL,
      selected_answer TEXT NOT NULL,
      is_correct      INTEGER NOT NULL,
      answered_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_quiz_sessions_user_id ON quiz_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_session_answers_session_id ON session_answers(session_id);

    -- 既存 DB への移行: カラムが存在しない場合のみ追加
    CREATE TEMPORARY TABLE IF NOT EXISTS _migration_guard (x INTEGER);
  `);

  // 既存テーブルへのカラム追加（ALTER TABLE は IF NOT EXISTS 非サポートのため try/catch）
  for (const sql of [
    "ALTER TABLE users ADD COLUMN github_id TEXT",
    "ALTER TABLE users ADD COLUMN github_login TEXT",
    "ALTER TABLE users DROP COLUMN email_not_null",
  ]) {
    try { db.exec(sql); } catch (_) { /* already exists */ }
  }
}

module.exports = { getDb };
