-- ============================================
-- DATABASE MIGRATIONS FOR CONTEST IMPROVEMENTS
-- ============================================
-- Run these SQL commands in your Supabase SQL Editor
-- Date: 2025-10-22
-- Purpose: Add leaderboard storage and improve contest tracking

-- ============================================
-- 1. Add current_leaderboard column to contest_state
-- ============================================
-- This stores real-time leaderboard snapshots during contest
ALTER TABLE public.contest_state 
ADD COLUMN IF NOT EXISTS current_leaderboard jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.contest_state.current_leaderboard IS 'Live leaderboard snapshot (top 100 users)';

-- ============================================
-- 2. Ensure contest_results table exists with proper structure
-- ============================================
-- This table should already exist, but let's verify its structure
-- If you get errors, the table likely exists - that's fine!

DO $$ 
BEGIN
    -- Check if contest_results table has all required columns
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'contest_results' 
        AND column_name = 'total_participants'
    ) THEN
        ALTER TABLE public.contest_results 
        ADD COLUMN total_participants integer DEFAULT 0;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'contest_results' 
        AND column_name = 'winner'
    ) THEN
        ALTER TABLE public.contest_results 
        ADD COLUMN winner jsonb;
    END IF;
END $$;

-- ============================================
-- 3. Create indexes for better query performance
-- ============================================

-- Index for portfolio queries (used in leaderboard)
CREATE INDEX IF NOT EXISTS idx_portfolio_total_wealth 
ON public.portfolio(total_wealth DESC);

CREATE INDEX IF NOT EXISTS idx_portfolio_user_email 
ON public.portfolio(user_email);

-- Index for short positions (used in auto square-off)
CREATE INDEX IF NOT EXISTS idx_short_positions_user_active 
ON public.short_positions(user_email, is_active) 
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_short_positions_active 
ON public.short_positions(is_active) 
WHERE is_active = true;

-- Index for trades (used in history queries)
CREATE INDEX IF NOT EXISTS idx_trades_user_timestamp 
ON public.trades(user_email, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_trades_timestamp 
ON public.trades(timestamp DESC);

-- Index for contest_state
CREATE INDEX IF NOT EXISTS idx_contest_state_running 
ON public.contest_state(is_running, start_time DESC);

-- ============================================
-- 4. Add helpful views for analytics
-- ============================================

-- View: Current Active Contest
CREATE OR REPLACE VIEW public.active_contest AS
SELECT 
    id,
    is_running,
    is_paused,
    start_time,
    current_tick_index,
    total_ticks,
    speed,
    symbols,
    created_at,
    updated_at,
    (current_leaderboard->0) as current_leader,
    jsonb_array_length(COALESCE(current_leaderboard, '[]'::jsonb)) as total_participants
FROM public.contest_state
WHERE is_running = true
ORDER BY start_time DESC
LIMIT 1;

COMMENT ON VIEW public.active_contest IS 'Shows the currently running contest with leader info';

-- View: Top Performers
CREATE OR REPLACE VIEW public.top_performers AS
SELECT 
    p.user_email,
    u."Candidate's Name" as user_name,
    p.total_wealth,
    p.total_pnl,
    ((p.total_wealth - 1000000) / 1000000) * 100 as return_percentage,
    p.cash_balance,
    p.market_value,
    p.short_value,
    p.realized_pnl,
    p.unrealized_pnl,
    p.last_updated,
    ROW_NUMBER() OVER (ORDER BY p.total_wealth DESC) as rank
FROM public.portfolio p
LEFT JOIN public.users u ON p.user_email = u."Candidate's Email"
ORDER BY p.total_wealth DESC;

COMMENT ON VIEW public.top_performers IS 'Real-time leaderboard view with rankings';

-- View: Contest Statistics
CREATE OR REPLACE VIEW public.contest_statistics AS
SELECT 
    COUNT(DISTINCT p.user_email) as total_participants,
    MAX(p.total_wealth) as highest_wealth,
    MIN(p.total_wealth) as lowest_wealth,
    AVG(p.total_wealth) as average_wealth,
    SUM(CASE WHEN p.total_wealth > 1000000 THEN 1 ELSE 0 END) as profitable_users,
    SUM(CASE WHEN p.total_wealth < 1000000 THEN 1 ELSE 0 END) as loss_making_users,
    SUM(CASE WHEN p.total_wealth = 1000000 THEN 1 ELSE 0 END) as breakeven_users,
    (SELECT COUNT(*) FROM public.trades) as total_trades_count,
    (SELECT COUNT(*) FROM public.short_positions WHERE is_active = true) as active_shorts_count
FROM public.portfolio p;

COMMENT ON VIEW public.contest_statistics IS 'Overall contest statistics';

-- ============================================
-- 5. Create function for automatic portfolio cleanup
-- ============================================

-- Function to reset all portfolios to 1M
CREATE OR REPLACE FUNCTION public.reset_all_portfolios()
RETURNS TABLE(reset_count bigint) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    affected_rows bigint;
BEGIN
    UPDATE public.portfolio
    SET 
        cash_balance = 1000000,
        holdings = '{}'::jsonb,
        market_value = 0,
        total_wealth = 1000000,
        short_value = 0,
        unrealized_pnl = 0,
        total_pnl = 0,
        realized_pnl = 0,
        last_updated = NOW();
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    
    RETURN QUERY SELECT affected_rows;
END;
$$;

COMMENT ON FUNCTION public.reset_all_portfolios() IS 'Resets all user portfolios to initial 1M cash state';

-- ============================================
-- 6. Create function for complete contest cleanup
-- ============================================

CREATE OR REPLACE FUNCTION public.cleanup_contest_data()
RETURNS TABLE(
    trades_deleted bigint,
    shorts_deleted bigint,
    portfolios_reset bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    trades_count bigint;
    shorts_count bigint;
    portfolio_count bigint;
BEGIN
    -- Delete all trades
    DELETE FROM public.trades;
    GET DIAGNOSTICS trades_count = ROW_COUNT;
    
    -- Delete all short positions
    DELETE FROM public.short_positions;
    GET DIAGNOSTICS shorts_count = ROW_COUNT;
    
    -- Reset all portfolios
    UPDATE public.portfolio
    SET 
        cash_balance = 1000000,
        holdings = '{}'::jsonb,
        market_value = 0,
        total_wealth = 1000000,
        short_value = 0,
        unrealized_pnl = 0,
        total_pnl = 0,
        realized_pnl = 0,
        last_updated = NOW();
    
    GET DIAGNOSTICS portfolio_count = ROW_COUNT;
    
    RETURN QUERY SELECT trades_count, shorts_count, portfolio_count;
END;
$$;

COMMENT ON FUNCTION public.cleanup_contest_data() IS 'Clears all contest data (trades, shorts) and resets portfolios';

-- ============================================
-- 7. Grant necessary permissions (adjust if needed)
-- ============================================

-- Grant execute permissions on functions to authenticated users
GRANT EXECUTE ON FUNCTION public.reset_all_portfolios() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_contest_data() TO service_role;

-- Grant select on views
GRANT SELECT ON public.active_contest TO authenticated;
GRANT SELECT ON public.top_performers TO authenticated;
GRANT SELECT ON public.contest_statistics TO authenticated;

-- ============================================
-- 8. Verification queries
-- ============================================

-- Run these to verify the changes were applied successfully:

-- Check if current_leaderboard column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'contest_state' 
AND column_name = 'current_leaderboard';

-- Check indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename IN ('portfolio', 'short_positions', 'trades')
ORDER BY tablename, indexname;

-- Check views
SELECT table_name 
FROM information_schema.views 
WHERE table_schema = 'public' 
AND table_name IN ('active_contest', 'top_performers', 'contest_statistics');

-- Check functions
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN ('reset_all_portfolios', 'cleanup_contest_data');

-- ============================================
-- USAGE EXAMPLES
-- ============================================

-- Example 1: Get current leaderboard
-- SELECT * FROM public.top_performers LIMIT 10;

-- Example 2: Get contest statistics
-- SELECT * FROM public.contest_statistics;

-- Example 3: Reset all portfolios (CAUTION: This affects all users!)
-- SELECT * FROM public.reset_all_portfolios();

-- Example 4: Complete contest cleanup (CAUTION: Deletes all data!)
-- SELECT * FROM public.cleanup_contest_data();

-- Example 5: View active contest info
-- SELECT * FROM public.active_contest;

-- ============================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================
-- UNCOMMENT THESE LINES IF YOU NEED TO UNDO THE CHANGES

-- DROP VIEW IF EXISTS public.active_contest;
-- DROP VIEW IF EXISTS public.top_performers;
-- DROP VIEW IF EXISTS public.contest_statistics;
-- DROP FUNCTION IF EXISTS public.reset_all_portfolios();
-- DROP FUNCTION IF EXISTS public.cleanup_contest_data();
-- ALTER TABLE public.contest_state DROP COLUMN IF EXISTS current_leaderboard;
-- DROP INDEX IF EXISTS idx_portfolio_total_wealth;
-- DROP INDEX IF EXISTS idx_portfolio_user_email;
-- DROP INDEX IF EXISTS idx_short_positions_user_active;
-- DROP INDEX IF EXISTS idx_short_positions_active;
-- DROP INDEX IF EXISTS idx_trades_user_timestamp;
-- DROP INDEX IF EXISTS idx_trades_timestamp;
-- DROP INDEX IF EXISTS idx_contest_state_running;

-- ============================================
-- END OF MIGRATIONS
-- ============================================
