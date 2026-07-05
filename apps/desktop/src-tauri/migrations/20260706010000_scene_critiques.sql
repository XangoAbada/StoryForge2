CREATE TABLE IF NOT EXISTS scene_critiques (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL,
  scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  ai_run_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  findings_json TEXT NOT NULL DEFAULT '[]',
  source_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scene_critiques_scene ON scene_critiques(scene_id);
CREATE INDEX IF NOT EXISTS idx_scene_critiques_book ON scene_critiques(book_id, updated_at);
