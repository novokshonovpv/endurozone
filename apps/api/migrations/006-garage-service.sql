CREATE TABLE bike_service_plans (
 id uuid PRIMARY KEY,
 bike_id uuid NOT NULL REFERENCES bikes(id) ON DELETE CASCADE,
 title text NOT NULL,
 interval_hours numeric NOT NULL CHECK (interval_hours>=0.01 AND interval_hours<=10000),
 due_hours numeric NOT NULL CHECK (due_hours BETWEEN 0 AND 100000),
 notes text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 0,
 active boolean NOT NULL DEFAULT true,
 last_hours numeric CHECK (last_hours BETWEEN 0 AND 100000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bike_service_plans_bike_idx ON bike_service_plans(bike_id);
CREATE TABLE bike_service_records (
 id uuid PRIMARY KEY,
 plan_id uuid NOT NULL REFERENCES bike_service_plans(id) ON DELETE CASCADE,
 title text NOT NULL,
 performed_on date NOT NULL,
 hours numeric NOT NULL CHECK (hours BETWEEN 0 AND 100000),
 cost_rub numeric NOT NULL CHECK (cost_rub BETWEEN 0 AND 10000000),
 notes text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bike_service_records_plan_idx ON bike_service_records(plan_id,performed_on DESC,created_at DESC,id DESC);
