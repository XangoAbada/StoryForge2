-- Automatyczne streszczenia kroczące (scena -> rozdział -> "story so far").
-- Trzymane OSOBNO od ręcznych pól summary autora. Hash treści sceny pozwala
-- tanio wykrywać nieaktualność bez dodatkowej tabeli; flagi stale na
-- rozdziale i książce sterują leniwą regeneracją wyższych poziomów.
ALTER TABLE scenes ADD COLUMN auto_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE scenes ADD COLUMN auto_summary_source_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE chapters ADD COLUMN auto_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE chapters ADD COLUMN auto_summary_stale INTEGER NOT NULL DEFAULT 0;
ALTER TABLE books ADD COLUMN story_so_far TEXT NOT NULL DEFAULT '';
ALTER TABLE books ADD COLUMN story_so_far_stale INTEGER NOT NULL DEFAULT 0;
