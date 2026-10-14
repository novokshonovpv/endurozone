ALTER TABLE locations ADD COLUMN kind text NOT NULL DEFAULT 'spot' CHECK (kind IN ('spot','rental','guide','school'));
ALTER TABLE locations ADD COLUMN contacts text NOT NULL DEFAULT '';
ALTER TABLE locations ALTER COLUMN difficulty DROP NOT NULL;
CREATE INDEX locations_kind_idx ON locations(kind, status, created_at DESC);
ALTER TABLE posts DROP CONSTRAINT posts_kind_check;
ALTER TABLE posts ADD CONSTRAINT posts_kind_check CHECK (kind IN ('ride','maintenance','build','news'));
