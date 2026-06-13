PRAGMA foreign_keys = OFF;

CREATE TABLE scenes_nullable_chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  plan_version_id TEXT NOT NULL,
  chapter_id TEXT,
  order_index INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  conflict TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  pov_character_id TEXT,
  location_id TEXT,
  target_word_count INTEGER,
  actual_word_count INTEGER NOT NULL DEFAULT 0,
  manuscript_content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL,
  FOREIGN KEY (pov_character_id) REFERENCES characters(id) ON DELETE SET NULL,
  FOREIGN KEY (location_id) REFERENCES world_elements(id) ON DELETE SET NULL
);

INSERT INTO scenes_nullable_chapters
  (id, book_id, plan_version_id, chapter_id, order_index, title, summary, goal, conflict, outcome, pov_character_id, location_id, target_word_count, actual_word_count, manuscript_content, status, created_at, updated_at)
SELECT
  id, book_id, plan_version_id, chapter_id, order_index, title, summary, goal, conflict, outcome, pov_character_id, location_id, target_word_count, actual_word_count, manuscript_content, status, created_at, updated_at
FROM scenes;

DROP TABLE scenes;
ALTER TABLE scenes_nullable_chapters RENAME TO scenes;

CREATE INDEX IF NOT EXISTS idx_scenes_plan_chapter_order
  ON scenes(plan_version_id, chapter_id, order_index);

PRAGMA foreign_keys = ON;
