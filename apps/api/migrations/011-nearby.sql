ALTER TABLE tracks ADD COLUMN min_lat double precision, ADD COLUMN max_lat double precision, ADD COLUMN min_lng double precision, ADD COLUMN max_lng double precision;
UPDATE tracks t SET min_lat=b.min_lat, max_lat=b.max_lat, min_lng=b.min_lng, max_lng=b.max_lng
  FROM (
    SELECT s.id, min((p->>1)::double precision) min_lat, max((p->>1)::double precision) max_lat,
      min((p->>0)::double precision) min_lng, max((p->>0)::double precision) max_lng
    FROM tracks s, jsonb_array_elements(s.geometry->'coordinates') segment, jsonb_array_elements(segment) p
    GROUP BY s.id
  ) b
  WHERE b.id=t.id;
CREATE INDEX tracks_published_bbox_idx ON tracks(min_lat,max_lat,min_lng,max_lng) WHERE status='published';
CREATE INDEX locations_published_geo_idx ON locations(latitude,longitude) WHERE status='published';
