CREATE SCHEMA IF NOT EXISTS solstock_guard;

CREATE TABLE solstock_guard.schema_versions (
  version integer PRIMARY KEY CHECK (version > 0),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE solstock_guard.policies (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  chain_namespace text NOT NULL CHECK (chain_namespace <> ''),
  network text NOT NULL CHECK (network <> ''),
  order_id text NOT NULL CHECK (order_id ~ '^[a-f0-9]{64}$'),
  owner_address text NOT NULL CHECK (owner_address <> ''),
  source_account text NOT NULL CHECK (source_account <> ''),
  state text NOT NULL CHECK (state IN
    ('DRAFT', 'ARMING', 'ARMED', 'TRIGGERED', 'SUBMITTED', 'CONFIRMED', 'REVOKED', 'EXPIRED', 'UNAVAILABLE', 'FAILED')),
  document jsonb NOT NULL CHECK (
    jsonb_typeof(document) = 'object'
    AND document ?& ARRAY['amountRaw', 'minimumOutputRaw']
    AND jsonb_typeof(document->'amountRaw') = 'string'
    AND jsonb_typeof(document->'minimumOutputRaw') = 'string'
    AND document->>'amountRaw' ~ '^[1-9][0-9]*$'
    AND document->>'minimumOutputRaw' ~ '^[1-9][0-9]*$'
  ),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (chain_namespace, network, owner_address, order_id),
  UNIQUE (id, chain_namespace, network)
);
-- An uncertain/failed attempt does not release the source for another policy.
CREATE UNIQUE INDEX one_unresolved_source ON solstock_guard.policies
  (chain_namespace, network, source_account)
  WHERE state NOT IN ('DRAFT', 'CONFIRMED', 'REVOKED', 'EXPIRED');

CREATE TABLE solstock_guard.observations (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  instrument text NOT NULL,
  source_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object')
);

CREATE TABLE solstock_guard.decisions (
  id uuid PRIMARY KEY,
  policy_id text NOT NULL REFERENCES solstock_guard.policies(id),
  rule_version text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE solstock_guard.attempts (
  id uuid PRIMARY KEY,
  policy_id text NOT NULL,
  chain_namespace text NOT NULL,
  network text NOT NULL,
  native_id text NOT NULL CHECK (native_id <> ''),
  transaction_bytes bytea NOT NULL CHECK (octet_length(transaction_bytes) > 0),
  validity jsonb NOT NULL CHECK (jsonb_typeof(validity) = 'object'),
  state text NOT NULL CHECK (state IN ('PREPARED', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'UNKNOWN', 'EXPIRED')),
  previous_attempt uuid REFERENCES solstock_guard.attempts(id),
  decision_id uuid REFERENCES solstock_guard.decisions(id),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (policy_id, chain_namespace, network)
    REFERENCES solstock_guard.policies(id, chain_namespace, network),
  UNIQUE (chain_namespace, network, native_id)
);
CREATE UNIQUE INDEX one_unresolved_attempt ON solstock_guard.attempts (policy_id)
  WHERE state IN ('PREPARED', 'SUBMITTED', 'UNKNOWN');

CREATE TABLE solstock_guard.policy_claims (
  policy_id text PRIMARY KEY REFERENCES solstock_guard.policies(id),
  worker_id text NOT NULL CHECK (worker_id <> ''),
  fence bigint NOT NULL CHECK (fence > 0),
  lease_until timestamptz NOT NULL
);

CREATE TABLE solstock_guard.events (
  sequence bigserial PRIMARY KEY,
  policy_id text REFERENCES solstock_guard.policies(id),
  kind text NOT NULL CHECK (kind <> ''),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX events_by_policy ON solstock_guard.events (policy_id, sequence);

INSERT INTO solstock_guard.schema_versions (version) VALUES (1);
