-- Card "length": total characters of the prompt-relevant text fields
-- (everything the card injects into context; creator_notes excluded).
-- Kept in sync by the repository on insert/update.

ALTER TABLE characters ADD COLUMN text_length INTEGER NOT NULL DEFAULT 0;

UPDATE characters SET text_length =
  length(description) + length(personality) + length(scenario) +
  length(first_mes) + length(mes_example) + length(system_prompt) +
  length(post_history_instructions) +
  COALESCE((SELECT SUM(length(g.content))
            FROM alternate_greetings g
            WHERE g.character_id = characters.id), 0);

CREATE INDEX idx_characters_text_length ON characters(text_length);
