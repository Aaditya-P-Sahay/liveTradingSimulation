-- ============================================
-- VERIFICATION AND FIX FOR TRADES TABLE
-- ============================================
-- Run this in Supabase SQL Editor to verify and fix any issues

-- 1. Check current trades table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'trades'
ORDER BY ordinal_position;

-- 2. Verify quantity column is INTEGER (not JSONB)
SELECT 
    column_name,
    data_type,
    udt_name
FROM information_schema.columns
WHERE table_name = 'trades' 
AND column_name IN ('quantity', 'price', 'total_amount');

-- Expected output:
-- quantity  | integer | int4
-- price     | numeric | numeric
-- total_amount | numeric | numeric

-- 3. If quantity is somehow JSONB, fix it:
-- UNCOMMENT AND RUN ONLY IF NEEDED:
-- ALTER TABLE public.trades ALTER COLUMN quantity TYPE integer USING (quantity::text::integer);

-- 4. Check for any triggers on trades table that might modify data
SELECT 
    trigger_name,
    event_manipulation,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'trades';

-- 5. Test insert with explicit types
DO $$ 
DECLARE
    test_trade_id uuid;
    test_user_email text;
BEGIN
    -- Get a real user email from the users table (note: column name has quotes and spaces)
    SELECT "Candidate's Email" INTO test_user_email
    FROM public.users
    LIMIT 1;

    -- If no users exist, skip the test
    IF test_user_email IS NULL THEN
        RAISE NOTICE 'No users found in database. Skipping insert test.';
        RAISE NOTICE 'Create a user account first, then re-run this test.';
        RETURN;
    END IF;

    RAISE NOTICE 'Using test user: %', test_user_email;

    -- Insert test trade
    INSERT INTO public.trades (
        user_email,
        symbol,
        company_name,
        order_type,
        quantity,
        price,
        total_amount
    ) VALUES (
        test_user_email,  -- Use real user email
        'TEST',
        'Test Company',
        'buy',
        100,  -- explicit integer
        2500.50,  -- explicit numeric
        250050.00  -- explicit numeric
    ) RETURNING id INTO test_trade_id;

    RAISE NOTICE 'Test trade inserted: %', test_trade_id;

    -- Check what was actually stored
    PERFORM pg_sleep(0.1);  -- Small delay
    
    RAISE NOTICE 'Checking inserted trade types...';
    
    -- Display the types
    DECLARE
        qty_type text;
        price_type text;
        qty_val integer;
        price_val numeric;
    BEGIN
        SELECT 
            pg_typeof(quantity)::text,
            pg_typeof(price)::text,
            quantity,
            price
        INTO qty_type, price_type, qty_val, price_val
        FROM public.trades
        WHERE id = test_trade_id;
        
        RAISE NOTICE 'quantity type: % (value: %)', qty_type, qty_val;
        RAISE NOTICE 'price type: % (value: %)', price_type, price_val;
        
        IF qty_type = 'integer' AND price_type = 'numeric' THEN
            RAISE NOTICE '✅ SUCCESS: Column types are correct!';
        ELSE
            RAISE WARNING '❌ PROBLEM: quantity should be integer, price should be numeric';
        END IF;
    END;

    -- Clean up test data
    DELETE FROM public.trades WHERE id = test_trade_id;
    
    RAISE NOTICE 'Test completed and cleaned up';
END $$;

-- 6. Check if there are any Row Level Security policies that might interfere
SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'trades';

-- 7. Grant proper permissions (if needed)
-- Ensure service role can insert into trades
GRANT INSERT, SELECT ON public.trades TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- 8. Verify foreign key constraints are not causing issues
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
AND tc.table_name = 'trades';

-- 9. Check if there are any cast issues in the database
-- This query will show if there's a function or cast that's being applied
SELECT 
    p.proname as function_name,
    pg_catalog.pg_get_function_arguments(p.oid) as arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type
FROM pg_catalog.pg_proc p
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname LIKE '%trade%'
OR p.proname LIKE '%quantity%';

-- ============================================
-- FINAL VERIFICATION
-- ============================================
-- After running the backend with fixes, check recent trades:
SELECT 
    id,
    user_email,
    symbol,
    order_type,
    pg_typeof(quantity) as quantity_type,
    quantity,
    pg_typeof(price) as price_type,
    price,
    pg_typeof(total_amount) as total_amount_type,
    total_amount,
    created_at
FROM public.trades
ORDER BY created_at DESC
LIMIT 5;

-- If you see quantity_type as 'jsonb', that's the problem!
-- Fix with:
-- ALTER TABLE public.trades ALTER COLUMN quantity TYPE integer 
-- USING CASE 
--     WHEN jsonb_typeof(quantity::jsonb) = 'number' THEN (quantity::jsonb)::text::integer
--     ELSE quantity::text::integer
-- END;
