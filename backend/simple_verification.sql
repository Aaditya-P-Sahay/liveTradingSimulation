-- ============================================
-- SIMPLE STEP-BY-STEP VERIFICATION
-- Run each query ONE AT A TIME and check the output
-- ============================================

-- ========================================
-- STEP 1: Check quantity column data type
-- ========================================
-- COPY AND RUN THIS FIRST:

SELECT 
    column_name,
    data_type,
    udt_name
FROM information_schema.columns
WHERE table_name = 'trades' 
AND column_name = 'quantity';

-- EXPECTED OUTPUT:
-- quantity | integer | int4
-- 
-- IF YOU SEE:
-- quantity | jsonb | jsonb  <-- THIS IS THE PROBLEM!


-- ========================================
-- STEP 2: Check ALL trades table columns
-- ========================================
-- COPY AND RUN THIS SECOND:

SELECT 
    column_name,
    data_type
FROM information_schema.columns
WHERE table_name = 'trades'
ORDER BY ordinal_position;


-- ========================================
-- STEP 3: Test direct insert (with real user)
-- ========================================
-- COPY AND RUN THIS THIRD:

DO $$ 
DECLARE
    test_user_email text;
    test_trade_id uuid;
BEGIN
    -- Get a real user
    SELECT "Candidate's Email" INTO test_user_email
    FROM public.users
    LIMIT 1;
    
    IF test_user_email IS NULL THEN
        RAISE EXCEPTION 'No users found! Create a user account first.';
    END IF;
    
    RAISE NOTICE 'Testing with user: %', test_user_email;
    
    -- Try to insert
    INSERT INTO public.trades (
        user_email,
        symbol,
        company_name,
        order_type,
        quantity,
        price,
        total_amount
    ) VALUES (
        test_user_email,
        'TESTSTOCK',
        'Test Company',
        'buy',
        100,        -- This should be integer
        2500.00,    -- This should be numeric
        250000.00   -- This should be numeric
    ) RETURNING id INTO test_trade_id;
    
    RAISE NOTICE 'SUCCESS! Test trade inserted with ID: %', test_trade_id;
    
    -- Clean up
    DELETE FROM public.trades WHERE id = test_trade_id;
    RAISE NOTICE 'Test trade cleaned up';
    
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'ERROR: %', SQLERRM;
    RAISE NOTICE 'ERROR CODE: %', SQLSTATE;
END $$;


-- ========================================
-- STEP 4: Check if any existing trades have wrong types
-- ========================================
-- COPY AND RUN THIS FOURTH (if you have existing trades):

SELECT 
    id,
    symbol,
    pg_typeof(quantity) as quantity_type,
    quantity,
    pg_typeof(price) as price_type,
    price
FROM public.trades
ORDER BY created_at DESC
LIMIT 5;

-- quantity_type should show: integer
-- price_type should show: numeric
