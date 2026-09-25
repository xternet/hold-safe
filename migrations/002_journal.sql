-- Preserve signed policy and attempt identity even if a future caller misuses SQL.
CREATE FUNCTION solstock_guard.immutable_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.chain_namespace, NEW.network, NEW.order_id, NEW.owner_address,
      NEW.source_account, NEW.document, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.chain_namespace, OLD.network, OLD.order_id, OLD.owner_address,
      OLD.source_account, OLD.document, OLD.created_at) THEN
    RAISE EXCEPTION 'Policy identity and document are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_policy BEFORE UPDATE ON solstock_guard.policies
  FOR EACH ROW EXECUTE FUNCTION solstock_guard.immutable_policy();

ALTER TABLE solstock_guard.decisions ADD UNIQUE (id, policy_id);
ALTER TABLE solstock_guard.attempts ADD UNIQUE (id, policy_id);
ALTER TABLE solstock_guard.attempts ADD FOREIGN KEY (decision_id, policy_id)
  REFERENCES solstock_guard.decisions (id, policy_id);
ALTER TABLE solstock_guard.attempts ADD FOREIGN KEY (previous_attempt, policy_id)
  REFERENCES solstock_guard.attempts (id, policy_id);
ALTER TABLE solstock_guard.attempts ALTER COLUMN decision_id SET NOT NULL;
ALTER TABLE solstock_guard.attempts ADD CHECK (previous_attempt IS DISTINCT FROM id);
CREATE UNIQUE INDEX one_initial_attempt ON solstock_guard.attempts(policy_id)
  WHERE previous_attempt IS NULL;
CREATE UNIQUE INDEX one_attempt_successor ON solstock_guard.attempts(previous_attempt)
  WHERE previous_attempt IS NOT NULL;

CREATE FUNCTION solstock_guard.immutable_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.policy_id, NEW.chain_namespace, NEW.network, NEW.native_id,
      NEW.transaction_bytes, NEW.validity, NEW.previous_attempt, NEW.decision_id,
      NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.policy_id, OLD.chain_namespace, OLD.network, OLD.native_id,
      OLD.transaction_bytes, OLD.validity, OLD.previous_attempt, OLD.decision_id,
      OLD.created_at) THEN
    RAISE EXCEPTION 'Signed attempt identity and bytes are immutable';
  END IF;
  IF OLD.state IN ('CONFIRMED', 'FAILED', 'EXPIRED') AND
     (NEW.state, NEW.receipt) IS DISTINCT FROM (OLD.state, OLD.receipt) THEN
    RAISE EXCEPTION 'Terminal attempt cannot be rewritten';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_attempt BEFORE UPDATE ON solstock_guard.attempts
  FOR EACH ROW EXECUTE FUNCTION solstock_guard.immutable_attempt();
CREATE FUNCTION solstock_guard.immutable_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Recorded decision evidence is immutable';
END $$;
CREATE TRIGGER immutable_decision BEFORE UPDATE ON solstock_guard.decisions
  FOR EACH ROW EXECUTE FUNCTION solstock_guard.immutable_decision();
CREATE INDEX active_policies_by_id ON solstock_guard.policies(id)
  WHERE state NOT IN ('DRAFT','CONFIRMED','REVOKED','EXPIRED');
INSERT INTO solstock_guard.schema_versions (version) VALUES (2);
