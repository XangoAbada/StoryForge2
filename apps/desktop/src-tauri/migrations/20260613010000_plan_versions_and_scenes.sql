PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plan_versions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Plan główny',
  description TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_versions_one_active
  ON plan_versions(book_id)
  WHERE is_active = 1;

INSERT INTO plan_versions (id, book_id, name, description, is_active, created_at, updated_at)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  b.id,
  'Plan główny',
  '',
  1,
  COALESCE(b.created_at, datetime('now')),
  COALESCE(b.updated_at, datetime('now'))
FROM books b
WHERE NOT EXISTS (
  SELECT 1 FROM plan_versions pv WHERE pv.book_id = b.id
);

ALTER TABLE acts ADD COLUMN plan_version_id TEXT;
ALTER TABLE beats ADD COLUMN plan_version_id TEXT;
ALTER TABLE plot_threads ADD COLUMN plan_version_id TEXT;
ALTER TABLE chapters ADD COLUMN plan_version_id TEXT;

UPDATE acts
SET plan_version_id = (
  SELECT pv.id FROM plan_versions pv
  WHERE pv.book_id = acts.book_id AND pv.is_active = 1
  LIMIT 1
)
WHERE plan_version_id IS NULL;

UPDATE beats
SET plan_version_id = (
  SELECT pv.id FROM plan_versions pv
  WHERE pv.book_id = beats.book_id AND pv.is_active = 1
  LIMIT 1
)
WHERE plan_version_id IS NULL;

UPDATE plot_threads
SET plan_version_id = (
  SELECT pv.id FROM plan_versions pv
  WHERE pv.book_id = plot_threads.book_id AND pv.is_active = 1
  LIMIT 1
)
WHERE plan_version_id IS NULL;

UPDATE chapters
SET plan_version_id = (
  SELECT pv.id FROM plan_versions pv
  WHERE pv.book_id = chapters.book_id AND pv.is_active = 1
  LIMIT 1
)
WHERE plan_version_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_acts_plan_version_order
  ON acts(plan_version_id, order_index);
CREATE INDEX IF NOT EXISTS idx_beats_plan_version_order
  ON beats(plan_version_id, order_index);
CREATE INDEX IF NOT EXISTS idx_plot_threads_plan_version_order
  ON plot_threads(plan_version_id, order_index);
CREATE INDEX IF NOT EXISTS idx_chapters_plan_version_order
  ON chapters(plan_version_id, order_index, number);

CREATE TABLE story_structures_new (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  plan_version_id TEXT,
  structure_type TEXT NOT NULL DEFAULT 'three_act',
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id) REFERENCES plan_versions(id) ON DELETE CASCADE
);

INSERT INTO story_structures_new
  (id, book_id, plan_version_id, structure_type, description, notes, status, created_at, updated_at)
SELECT
  s.id,
  s.book_id,
  (SELECT pv.id FROM plan_versions pv WHERE pv.book_id = s.book_id AND pv.is_active = 1 LIMIT 1),
  s.structure_type,
  s.description,
  s.notes,
  s.status,
  s.created_at,
  s.updated_at
FROM story_structures s;

DROP TABLE story_structures;
ALTER TABLE story_structures_new RENAME TO story_structures;

CREATE UNIQUE INDEX IF NOT EXISTS idx_story_structures_plan_version
  ON story_structures(plan_version_id);
CREATE INDEX IF NOT EXISTS idx_story_structures_book
  ON story_structures(book_id);

CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  plan_version_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
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
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
  FOREIGN KEY (pov_character_id) REFERENCES characters(id) ON DELETE SET NULL,
  FOREIGN KEY (location_id) REFERENCES world_elements(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_scenes_plan_chapter_order
  ON scenes(plan_version_id, chapter_id, order_index);

CREATE TABLE IF NOT EXISTS scene_characters (
  scene_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  PRIMARY KEY (scene_id, character_id),
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scene_threads (
  scene_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY (scene_id, thread_id),
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES plot_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scene_world_elements (
  scene_id TEXT NOT NULL,
  element_id TEXT NOT NULL,
  PRIMARY KEY (scene_id, element_id),
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
  FOREIGN KEY (element_id) REFERENCES world_elements(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scene_world_rules (
  scene_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  PRIMARY KEY (scene_id, rule_id),
  FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
  FOREIGN KEY (rule_id) REFERENCES world_rules(id) ON DELETE CASCADE
);
