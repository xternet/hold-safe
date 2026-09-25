INSERT INTO solstock_guard.policies
  (id, chain_namespace, network, order_id, owner_address, source_account, state, document)
VALUES
  (repeat('a', 64), 'solana', 'test-domain', repeat('1', 64), 'owner', 'source', 'ARMED', '{"amountRaw":"100","minimumOutputRaw":"90"}'),
  (repeat('b', 64), 'solana', 'other-domain', repeat('1', 64), 'owner', 'source', 'ARMED', '{"amountRaw":"100","minimumOutputRaw":"90"}');

DO $$
BEGIN
  BEGIN
    INSERT INTO solstock_guard.policies
      (id, chain_namespace, network, order_id, owner_address, source_account, state, document)
    VALUES (repeat('c', 64), 'solana', 'test-domain', repeat('2', 64), 'owner', 'source', 'ARMING', '{"amountRaw":"100","minimumOutputRaw":"90"}');
    RAISE EXCEPTION 'second unresolved policy unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'expected: duplicate active source rejected';
  END;
  BEGIN
    INSERT INTO solstock_guard.policies
      (id, chain_namespace, network, order_id, owner_address, source_account, state, document)
    VALUES (repeat('d', 64), 'solana', 'test-domain', repeat('3', 64), 'owner', 'other-source', 'DRAFT', '{"amountRaw":"1e3","minimumOutputRaw":"90"}');
    RAISE EXCEPTION 'noncanonical amount unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'expected: malformed amount rejected';
  END;
END $$;

INSERT INTO solstock_guard.attempts
  (id, policy_id, chain_namespace, network, native_id, transaction_bytes, validity, state)
VALUES ('00000000-0000-0000-0000-000000000001', repeat('a', 64), 'solana', 'test-domain', 'sig-1', decode('0102', 'hex'), '{"fixture":true}', 'PREPARED');

DO $$
BEGIN
  BEGIN
    INSERT INTO solstock_guard.attempts
      (id, policy_id, chain_namespace, network, native_id, transaction_bytes, validity, state)
    VALUES ('00000000-0000-0000-0000-000000000002', repeat('a', 64), 'solana', 'test-domain', 'sig-2', decode('0103', 'hex'), '{"fixture":true}', 'UNKNOWN');
    RAISE EXCEPTION 'parallel unresolved transaction unexpectedly accepted';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'expected: duplicate unresolved attempt rejected';
  END;
  BEGIN
    INSERT INTO solstock_guard.attempts
      (id, policy_id, chain_namespace, network, native_id, transaction_bytes, validity, state)
    VALUES ('00000000-0000-0000-0000-000000000003', repeat('b', 64), 'solana', 'wrong-domain', 'sig-3', decode('0103', 'hex'), '{"fixture":true}', 'PREPARED');
    RAISE EXCEPTION 'foreign domain unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'expected: wrong attempt domain rejected';
  END;
END $$;

UPDATE solstock_guard.attempts SET state = 'EXPIRED' WHERE native_id = 'sig-1';
INSERT INTO solstock_guard.attempts
  (id, policy_id, chain_namespace, network, native_id, transaction_bytes, validity, state)
VALUES ('00000000-0000-0000-0000-000000000004', repeat('a', 64), 'solana', 'test-domain', 'sig-4', decode('0104', 'hex'), '{"fixture":true}', 'PREPARED');

DO $$
BEGIN
  IF (SELECT count(*) FROM solstock_guard.attempts) <> 2 THEN
    RAISE EXCEPTION 'unexpected attempt count';
  END IF;
END $$;
