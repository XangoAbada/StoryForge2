PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS world_elements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  element_type TEXT NOT NULL DEFAULT 'location',
  name TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  story_purpose TEXT NOT NULL DEFAULT '',
  constraints TEXT NOT NULL DEFAULT '',
  visual_prompt TEXT NOT NULL DEFAULT '',
  image_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (image_asset_id) REFERENCES visual_assets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_world_elements_project_order
  ON world_elements(project_id, order_index, created_at);

CREATE TABLE IF NOT EXISTS world_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  cost TEXT NOT NULL DEFAULT '',
  limitation TEXT NOT NULL DEFAULT '',
  exceptions TEXT NOT NULL DEFAULT '',
  violation_consequences TEXT NOT NULL DEFAULT '',
  scene_examples TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_world_rules_project_order
  ON world_rules(project_id, order_index, created_at);

CREATE TABLE IF NOT EXISTS world_element_characters (
  element_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  PRIMARY KEY (element_id, character_id),
  FOREIGN KEY (element_id) REFERENCES world_elements(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_element_threads (
  element_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY (element_id, thread_id),
  FOREIGN KEY (element_id) REFERENCES world_elements(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES plot_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_element_chapters (
  element_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  PRIMARY KEY (element_id, chapter_id),
  FOREIGN KEY (element_id) REFERENCES world_elements(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_element_rules (
  element_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  PRIMARY KEY (element_id, rule_id),
  FOREIGN KEY (element_id) REFERENCES world_elements(id) ON DELETE CASCADE,
  FOREIGN KEY (rule_id) REFERENCES world_rules(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_rule_threads (
  rule_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY (rule_id, thread_id),
  FOREIGN KEY (rule_id) REFERENCES world_rules(id) ON DELETE CASCADE,
  FOREIGN KEY (thread_id) REFERENCES plot_threads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_rule_chapters (
  rule_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  PRIMARY KEY (rule_id, chapter_id),
  FOREIGN KEY (rule_id) REFERENCES world_rules(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);
