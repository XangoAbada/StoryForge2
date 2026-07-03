-- Globalne wyszukiwanie pełnotekstowe: sceny, postacie, elementy świata.
-- ponytail: body scen indeksuje surowy HTML Tiptapa (nazwy tagów to szum,
-- ale wyszukiwanie prozy działa); strip HTML w triggerze, gdy zacznie przeszkadzać.
CREATE VIRTUAL TABLE search_index USING fts5(
    entity_type UNINDEXED,
    entity_id UNINDEXED,
    project_id UNINDEXED,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- Backfill istniejących danych
INSERT INTO search_index (entity_type, entity_id, project_id, title, body)
SELECT 'scene', s.id, b.project_id, s.title, s.summary || ' ' || s.manuscript_content
FROM scenes s
JOIN books b ON b.id = s.book_id;

INSERT INTO search_index (entity_type, entity_id, project_id, title, body)
SELECT 'character', id, project_id, name, short_description
FROM characters;

INSERT INTO search_index (entity_type, entity_id, project_id, title, body)
SELECT 'world_element', id, project_id, name, summary || ' ' || details
FROM world_elements;

-- Sceny
CREATE TRIGGER search_index_scenes_ai AFTER INSERT ON scenes BEGIN
    INSERT INTO search_index (entity_type, entity_id, project_id, title, body)
    VALUES (
        'scene',
        new.id,
        (SELECT project_id FROM books WHERE id = new.book_id),
        new.title,
        new.summary || ' ' || new.manuscript_content
    );
END;

CREATE TRIGGER search_index_scenes_au AFTER UPDATE ON scenes BEGIN
    DELETE FROM search_index WHERE entity_type = 'scene' AND entity_id = old.id;
    INSERT INTO search_index (entity_type, entity_id, project_id, title, body)
    VALUES (
        'scene',
        new.id,
        (SELECT project_id FROM books WHERE id = new.book_id),
        new.title,
        new.summary || ' ' || new.manuscript_content
    );
END;

CREATE TRIGGER search_index_scenes_ad AFTER DELETE ON scenes BEGIN
    DELETE FROM search_index WHERE entity_type = 'scene' AND entity_id = old.id;
END;

-- Postacie
CREATE TRIGGER search_index_characters_ai AFTER INSERT ON characters BEGIN
    INSERT INTO search_index (entity_type, entity_id, project_id, title, body)
    VALUES ('character', new.id, new.project_id, new.name, new.short_description);
END;

CREATE TRIGGER search_index_characters_au AFTER UPDATE ON characters BEGIN
    DELETE FROM search_index WHERE entity_type = 'character' AND entity_id = old.id;
    INSERT INTO search_index (entity_type, entity_id, project_id, title, body)
    VALUES ('character', new.id, new.project_id, new.name, new.short_description);
END;

CREATE TRIGGER search_index_characters_ad AFTER DELETE ON characters BEGIN
    DELETE FROM search_index WHERE entity_type = 'character' AND entity_id = old.id;
END;

-- Elementy świata
CREATE TRIGGER search_index_world_elements_ai AFTER INSERT ON world_elements BEGIN
    INSERT INTO search_index (entity_type, entity_id, project_id, title, body)
    VALUES ('world_element', new.id, new.project_id, new.name, new.summary || ' ' || new.details);
END;

CREATE TRIGGER search_index_world_elements_au AFTER UPDATE ON world_elements BEGIN
    DELETE FROM search_index WHERE entity_type = 'world_element' AND entity_id = old.id;
    INSERT INTO search_index (entity_type, entity_id, project_id, title, body)
    VALUES ('world_element', new.id, new.project_id, new.name, new.summary || ' ' || new.details);
END;

CREATE TRIGGER search_index_world_elements_ad AFTER DELETE ON world_elements BEGIN
    DELETE FROM search_index WHERE entity_type = 'world_element' AND entity_id = old.id;
END;
