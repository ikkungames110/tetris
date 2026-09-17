-- Rename in place so user IDs, sessions, records, constraints and indexes survive.
ALTER TABLE users RENAME COLUMN email TO username;

CREATE TABLE initial_usernames AS
SELECT id, substr(username, 1, instr(username, '@') - 1) COLLATE NOCASE AS name,
  row_number() OVER (ORDER BY created_at, id) AS ordinal
FROM users WHERE kind = 'member';

-- Reserve player-<ordinal> for collisions/invalid legacy names. Move all names out of
-- the target namespace first so the UNIQUE constraint remains valid throughout.
UPDATE users SET username = '@migration:' || id WHERE kind = 'member';
UPDATE users SET username = (
  SELECT CASE WHEN length(name) BETWEEN 1 AND 40
    AND name NOT GLOB ('*[' || char(1) || '-' || char(32) || char(127) || ']*')
    AND name NOT LIKE 'player-%'
    AND (SELECT count(*) FROM initial_usernames other WHERE other.name = candidate.name COLLATE NOCASE) = 1
    THEN name ELSE 'player-' || candidate.ordinal END
  FROM initial_usernames candidate WHERE candidate.id = users.id
) WHERE kind = 'member';
DROP TABLE initial_usernames;
