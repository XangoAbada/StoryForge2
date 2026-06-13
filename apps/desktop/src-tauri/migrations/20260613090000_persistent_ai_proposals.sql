CREATE TABLE IF NOT EXISTS ai_proposals_next (
  id TEXT PRIMARY KEY,
  ai_run_id TEXT,
  project_id TEXT NOT NULL,
  proposal_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decision_status TEXT NOT NULL DEFAULT 'pending',
  applied_at TEXT,
  accepted_at TEXT,
  rejected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (ai_run_id) REFERENCES ai_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO ai_proposals_next
  (
    id,
    ai_run_id,
    project_id,
    proposal_type,
    payload_json,
    status,
    decision_status,
    applied_at,
    accepted_at,
    rejected_at,
    created_at,
    updated_at
  )
SELECT
  id,
  ai_run_id,
  project_id,
  proposal_type,
  payload_json,
  status,
  CASE
    WHEN status = 'accepted' OR applied_at IS NOT NULL THEN 'accepted'
    WHEN status = 'rejected' THEN 'rejected'
    ELSE 'pending'
  END,
  applied_at,
  CASE WHEN status = 'accepted' OR applied_at IS NOT NULL THEN applied_at ELSE NULL END,
  CASE WHEN status = 'rejected' THEN applied_at ELSE NULL END,
  created_at,
  COALESCE(applied_at, created_at)
FROM ai_proposals;

DROP TABLE ai_proposals;

ALTER TABLE ai_proposals_next RENAME TO ai_proposals;

CREATE INDEX IF NOT EXISTS idx_ai_proposals_project_decision_status
  ON ai_proposals(project_id, decision_status, updated_at);

CREATE INDEX IF NOT EXISTS idx_ai_proposals_ai_run_id
  ON ai_proposals(ai_run_id);
