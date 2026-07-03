-- Migawki tekstu sceny: historia zmian manuskryptu z możliwością przywrócenia.
-- Auto-migawka powstaje przed nadpisaniem tekstu przez zaakceptowaną propozycję AI.
CREATE TABLE scene_snapshots (
    id TEXT PRIMARY KEY,
    scene_id TEXT NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    word_count INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL
);

CREATE INDEX idx_scene_snapshots_scene_created
    ON scene_snapshots(scene_id, created_at DESC);
