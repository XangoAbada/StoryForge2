-- Znacznik czasu sceny ("następnego ranka", "3 dni później") — tanie pole,
-- duży zysk dla ciągłości chronologii w promptach i dla autora.
ALTER TABLE scenes ADD COLUMN time_marker TEXT NOT NULL DEFAULT '';
