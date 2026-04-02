-- Credit deduction logic tests
-- Run against a test database after migrations:
--   psql $DATABASE_URL < tests/credit_deduction.sql

BEGIN;

-- Setup: create a test user
INSERT INTO users (slug, auth_provider, reputation_score, total_uploads, total_tips_received_yocto,
    is_admin, is_banned, credit_balance, daily_credits_used, daily_credits_date)
VALUES ('test-user-001', 'test', 0, 0, '0', false, false, 100, 0, CURRENT_DATE)
ON CONFLICT DO NOTHING;

-- Get user ID
DO $$
DECLARE
    uid INTEGER;
    new_balance INTEGER;
    fd INTEGER;
    fp INTEGER;
BEGIN
    SELECT id INTO uid FROM users WHERE slug = 'test-user-001';

    -- ========================================================
    -- TEST 1: Non-premium user, deduct 12 from purchased
    -- ========================================================
    WITH state AS (
        SELECT id, credit_balance, is_admin,
            premium_until IS NOT NULL AND premium_until > NOW() as is_premium,
            CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END as used_today
        FROM users WHERE id = uid FOR UPDATE
    ),
    calc AS (
        SELECT
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN LEAST(12, GREATEST(0, 40 - used_today))
                 ELSE 0 END as from_daily,
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN GREATEST(0, 12 - LEAST(12, GREATEST(0, 40 - used_today)))
                 ELSE 12 END as from_purchased,
            is_admin
        FROM state
    )
    UPDATE users SET
        daily_credits_date = CURRENT_DATE,
        daily_credits_used = CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END
            + (SELECT from_daily FROM calc),
        credit_balance = credit_balance - (SELECT from_purchased FROM calc)
    FROM calc
    WHERE users.id = uid AND (calc.is_admin OR credit_balance >= calc.from_purchased)
    RETURNING credit_balance, (SELECT from_daily FROM calc), (SELECT from_purchased FROM calc)
    INTO new_balance, fd, fp;

    ASSERT new_balance = 88, 'TEST 1 FAILED: expected balance 88, got ' || new_balance;
    ASSERT fd = 0, 'TEST 1 FAILED: expected from_daily 0, got ' || fd;
    ASSERT fp = 12, 'TEST 1 FAILED: expected from_purchased 12, got ' || fp;
    RAISE NOTICE 'TEST 1 PASSED: non-premium deduct 12 → balance=88, from_daily=0, from_purchased=12';

    -- ========================================================
    -- TEST 2: Make user premium, deduct 12 → all from daily
    -- ========================================================
    UPDATE users SET premium_since = NOW(), premium_until = NOW() + INTERVAL '30 days',
        daily_credits_used = 0, daily_credits_date = CURRENT_DATE,
        credit_balance = 100
    WHERE id = uid;

    WITH state AS (
        SELECT id, credit_balance, is_admin,
            premium_until IS NOT NULL AND premium_until > NOW() as is_premium,
            CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END as used_today
        FROM users WHERE id = uid FOR UPDATE
    ),
    calc AS (
        SELECT
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN LEAST(12, GREATEST(0, 40 - used_today))
                 ELSE 0 END as from_daily,
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN GREATEST(0, 12 - LEAST(12, GREATEST(0, 40 - used_today)))
                 ELSE 12 END as from_purchased,
            is_admin
        FROM state
    )
    UPDATE users SET
        daily_credits_date = CURRENT_DATE,
        daily_credits_used = CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END
            + (SELECT from_daily FROM calc),
        credit_balance = credit_balance - (SELECT from_purchased FROM calc)
    FROM calc
    WHERE users.id = uid AND (calc.is_admin OR credit_balance >= calc.from_purchased)
    RETURNING credit_balance, (SELECT from_daily FROM calc), (SELECT from_purchased FROM calc)
    INTO new_balance, fd, fp;

    ASSERT new_balance = 100, 'TEST 2 FAILED: expected balance 100, got ' || new_balance;
    ASSERT fd = 12, 'TEST 2 FAILED: expected from_daily 12, got ' || fd;
    ASSERT fp = 0, 'TEST 2 FAILED: expected from_purchased 0, got ' || fp;
    RAISE NOTICE 'TEST 2 PASSED: premium deduct 12 → balance=100, from_daily=12, from_purchased=0';

    -- ========================================================
    -- TEST 3: Premium with 36 daily used, deduct 12 → 4 daily + 8 purchased
    -- ========================================================
    UPDATE users SET daily_credits_used = 36, credit_balance = 100 WHERE id = uid;

    WITH state AS (
        SELECT id, credit_balance, is_admin,
            premium_until IS NOT NULL AND premium_until > NOW() as is_premium,
            CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END as used_today
        FROM users WHERE id = uid FOR UPDATE
    ),
    calc AS (
        SELECT
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN LEAST(12, GREATEST(0, 40 - used_today))
                 ELSE 0 END as from_daily,
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN GREATEST(0, 12 - LEAST(12, GREATEST(0, 40 - used_today)))
                 ELSE 12 END as from_purchased,
            is_admin
        FROM state
    )
    UPDATE users SET
        daily_credits_date = CURRENT_DATE,
        daily_credits_used = CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END
            + (SELECT from_daily FROM calc),
        credit_balance = credit_balance - (SELECT from_purchased FROM calc)
    FROM calc
    WHERE users.id = uid AND (calc.is_admin OR credit_balance >= calc.from_purchased)
    RETURNING credit_balance, (SELECT from_daily FROM calc), (SELECT from_purchased FROM calc)
    INTO new_balance, fd, fp;

    ASSERT new_balance = 92, 'TEST 3 FAILED: expected balance 92, got ' || new_balance;
    ASSERT fd = 4, 'TEST 3 FAILED: expected from_daily 4, got ' || fd;
    ASSERT fp = 8, 'TEST 3 FAILED: expected from_purchased 8, got ' || fp;
    RAISE NOTICE 'TEST 3 PASSED: premium 36/40 used, deduct 12 → balance=92, from_daily=4, from_purchased=8';

    -- ========================================================
    -- TEST 4: Premium, daily exhausted (40 used), deduct 12 → all purchased
    -- ========================================================
    UPDATE users SET daily_credits_used = 40, credit_balance = 100 WHERE id = uid;

    WITH state AS (
        SELECT id, credit_balance, is_admin,
            premium_until IS NOT NULL AND premium_until > NOW() as is_premium,
            CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END as used_today
        FROM users WHERE id = uid FOR UPDATE
    ),
    calc AS (
        SELECT
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN LEAST(12, GREATEST(0, 40 - used_today))
                 ELSE 0 END as from_daily,
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN GREATEST(0, 12 - LEAST(12, GREATEST(0, 40 - used_today)))
                 ELSE 12 END as from_purchased,
            is_admin
        FROM state
    )
    UPDATE users SET
        daily_credits_date = CURRENT_DATE,
        daily_credits_used = CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END
            + (SELECT from_daily FROM calc),
        credit_balance = credit_balance - (SELECT from_purchased FROM calc)
    FROM calc
    WHERE users.id = uid AND (calc.is_admin OR credit_balance >= calc.from_purchased)
    RETURNING credit_balance, (SELECT from_daily FROM calc), (SELECT from_purchased FROM calc)
    INTO new_balance, fd, fp;

    ASSERT new_balance = 88, 'TEST 4 FAILED: expected balance 88, got ' || new_balance;
    ASSERT fd = 0, 'TEST 4 FAILED: expected from_daily 0, got ' || fd;
    ASSERT fp = 12, 'TEST 4 FAILED: expected from_purchased 12, got ' || fp;
    RAISE NOTICE 'TEST 4 PASSED: premium daily exhausted → balance=88, from_daily=0, from_purchased=12';

    -- ========================================================
    -- TEST 5: Daily reset on new day (simulate yesterday's date)
    -- ========================================================
    UPDATE users SET daily_credits_used = 40, daily_credits_date = CURRENT_DATE - 1, credit_balance = 100 WHERE id = uid;

    WITH state AS (
        SELECT id, credit_balance, is_admin,
            premium_until IS NOT NULL AND premium_until > NOW() as is_premium,
            CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END as used_today
        FROM users WHERE id = uid FOR UPDATE
    ),
    calc AS (
        SELECT
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN LEAST(12, GREATEST(0, 40 - used_today))
                 ELSE 0 END as from_daily,
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN GREATEST(0, 12 - LEAST(12, GREATEST(0, 40 - used_today)))
                 ELSE 12 END as from_purchased,
            is_admin
        FROM state
    )
    UPDATE users SET
        daily_credits_date = CURRENT_DATE,
        daily_credits_used = CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END
            + (SELECT from_daily FROM calc),
        credit_balance = credit_balance - (SELECT from_purchased FROM calc)
    FROM calc
    WHERE users.id = uid AND (calc.is_admin OR credit_balance >= calc.from_purchased)
    RETURNING credit_balance, (SELECT from_daily FROM calc), (SELECT from_purchased FROM calc)
    INTO new_balance, fd, fp;

    ASSERT new_balance = 100, 'TEST 5 FAILED: expected balance 100, got ' || new_balance;
    ASSERT fd = 12, 'TEST 5 FAILED: expected from_daily 12, got ' || fd;
    ASSERT fp = 0, 'TEST 5 FAILED: expected from_purchased 0, got ' || fp;
    RAISE NOTICE 'TEST 5 PASSED: daily reset on new day → balance=100, from_daily=12, from_purchased=0';

    -- ========================================================
    -- TEST 6: Insufficient credits → no deduction (returns empty)
    -- ========================================================
    UPDATE users SET premium_until = NULL, credit_balance = 5, daily_credits_used = 0 WHERE id = uid;

    WITH state AS (
        SELECT id, credit_balance, is_admin,
            premium_until IS NOT NULL AND premium_until > NOW() as is_premium,
            CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END as used_today
        FROM users WHERE id = uid FOR UPDATE
    ),
    calc AS (
        SELECT
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN LEAST(12, GREATEST(0, 40 - used_today))
                 ELSE 0 END as from_daily,
            CASE WHEN is_admin THEN 0
                 WHEN is_premium THEN GREATEST(0, 12 - LEAST(12, GREATEST(0, 40 - used_today)))
                 ELSE 12 END as from_purchased,
            is_admin
        FROM state
    )
    UPDATE users SET
        daily_credits_date = CURRENT_DATE,
        daily_credits_used = CASE WHEN daily_credits_date = CURRENT_DATE THEN daily_credits_used ELSE 0 END
            + (SELECT from_daily FROM calc),
        credit_balance = credit_balance - (SELECT from_purchased FROM calc)
    FROM calc
    WHERE users.id = uid AND (calc.is_admin OR credit_balance >= calc.from_purchased)
    RETURNING credit_balance, (SELECT from_daily FROM calc), (SELECT from_purchased FROM calc)
    INTO new_balance, fd, fp;

    IF new_balance IS NULL THEN
        RAISE NOTICE 'TEST 6 PASSED: insufficient credits (5 < 12) → no deduction';
    ELSE
        RAISE EXCEPTION 'TEST 6 FAILED: expected no rows, got balance=%', new_balance;
    END IF;

    -- Verify balance unchanged
    SELECT credit_balance INTO new_balance FROM users WHERE id = uid;
    ASSERT new_balance = 5, 'TEST 6 VERIFY FAILED: balance should still be 5, got ' || new_balance;

    RAISE NOTICE '✓ All 6 tests passed';
END $$;

-- Cleanup
DELETE FROM users WHERE slug = 'test-user-001';

ROLLBACK;
