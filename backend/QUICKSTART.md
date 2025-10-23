# 🚀 Quick Start Guide - After Fixes Applied

## Step 1: Apply Database Migrations

1. Open Supabase Dashboard
2. Go to SQL Editor
3. Copy the entire contents of `backend/database_migrations.sql`
4. Paste and Run

**Expected Output**: 
- ✅ Column `current_leaderboard` added to `contest_state`
- ✅ 7 indexes created
- ✅ 3 views created
- ✅ 2 functions created

---

## Step 2: Verify Database Changes

Run this in Supabase SQL Editor:

```sql
-- Check if migrations applied successfully
SELECT 
    'current_leaderboard column' as check_item,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'contest_state' 
            AND column_name = 'current_leaderboard'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING'
    END as status
UNION ALL
SELECT 
    'Indexes created',
    CASE 
        WHEN (SELECT COUNT(*) FROM pg_indexes 
              WHERE tablename IN ('portfolio', 'short_positions', 'trades')
              AND indexname LIKE 'idx_%') >= 7
        THEN '✅ CREATED'
        ELSE '❌ MISSING'
    END
UNION ALL
SELECT 
    'Views created',
    CASE 
        WHEN (SELECT COUNT(*) FROM information_schema.views 
              WHERE table_name IN ('top_performers', 'active_contest', 'contest_statistics')) = 3
        THEN '✅ CREATED'
        ELSE '❌ MISSING'
    END;
```

---

## Step 3: Test the Backend

```powershell
cd backend

# Install dependencies (if not already)
npm install

# Run tests
npm test

# Expected output:
# ✓ Auto Square-Off on Contest End (3 tests)
# ✓ Contest Reset Functionality (5 tests)
# ✓ All other existing tests passing
```

---

## Step 4: Start the Application

### Terminal 1 - Backend
```powershell
cd backend
npm run dev
```

**Expected Output**:
```
🚀 TRADING PLATFORM - COMPLETE FIXED VERSION
========================================
📍 Port: 3002
📊 WebSocket: Enabled
🔐 Auth: Supabase
💾 Database: Connected
🕐 Contest: 1 hour (5x speed)
📈 Timeframes: 5s, 30s, 1m, 3m, 5m
🎯 Type Safety: FULL
🔧 Auto Square-Off: FIXED
🧹 Data Reset: IMPLEMENTED
✅ Ready for 200+ users
========================================
✅ Server ready!
```

### Terminal 2 - Frontend
```powershell
cd frontend
npm run dev
```

---

## Step 5: Test Contest Flow Manually

### 5.1 Login as Admin
- Email: (your admin email)
- Password: (your admin password)

### 5.2 Start Contest
1. Click "Start Contest" in Admin panel
2. **Watch backend logs**:
   ```
   🚀 ============================================
   🚀 STARTING NEW CONTEST
   🚀 ============================================
   💰 Ensuring all users have 1M cash for new contest...
   ✅ Contest started successfully
   ```

### 5.3 Make Trades (as regular user)
1. Login as regular user
2. Buy some stocks
3. Short sell some stocks
4. Verify portfolio updates in real-time

### 5.4 Stop Contest
1. Switch to admin account
2. Click "Stop Contest"
3. **Watch backend logs**:
   ```
   🛑 STOPPING CONTEST
   🔄 Auto-squaring off N short positions...
   📊 SYMBOL: Short@₹X Cover@₹Y P&L=₹Z
   💰 user@email: Cash ₹A → ₹B
   ✅ Auto squared-off N positions
   📊 Calculating final leaderboard...
   🧹 STARTING CONTEST DATA CLEANUP
   📋 Step 1/3: Clearing trades...
   📋 Step 2/3: Clearing short positions...
   📋 Step 3/3: Resetting portfolios to 1M cash...
   ✅ Contest data cleanup completed
   ```

### 5.5 Verify Database
Run in Supabase SQL Editor:

```sql
-- Check all trades cleared
SELECT COUNT(*) as trade_count FROM trades;
-- Should return 0

-- Check all shorts cleared
SELECT COUNT(*) as shorts_count FROM short_positions;
-- Should return 0

-- Check all portfolios reset
SELECT 
    user_email, 
    cash_balance, 
    total_wealth,
    jsonb_pretty(holdings) as holdings
FROM portfolio
LIMIT 5;
-- All should have:
-- cash_balance = 1000000
-- total_wealth = 1000000
-- holdings = {}
```

### 5.6 Start New Contest
1. Click "Start Contest" again
2. Verify users have fresh 1M cash
3. Test trading again

---

## Step 6: Test Auto Square-Off Specifically

### Setup:
1. Start contest
2. Login as user
3. Short sell 100 ADANIENT (or any stock)
4. Note: Cash should increase by (100 × current_price)

### Trigger Auto Square-Off:
**Option A**: Wait for 60 minutes (contest ends)

**Option B**: Stop contest manually as admin

### Verify:
1. **Backend logs should show**:
   ```
   🔄 Auto-squaring off 1 short positions...
   📊 ADANIENT: Short@₹2500.00 Cover@₹2400.00 Qty=100 P&L=₹10000.00
   💰 user@email: Cash ₹1250000.00 → ₹1010000.00
   ```

2. **Database should show**:
   ```sql
   -- Check portfolio
   SELECT cash_balance, realized_pnl, short_value 
   FROM portfolio 
   WHERE user_email = 'your-email';
   
   -- Expected:
   -- cash_balance: 1,010,000 (if profit scenario)
   -- realized_pnl: 10,000
   -- short_value: 0
   
   -- Check short position
   SELECT is_active FROM short_positions 
   WHERE user_email = 'your-email';
   
   -- Expected: is_active = false
   
   -- Check cover trade recorded
   SELECT * FROM trades 
   WHERE user_email = 'your-email' 
   AND order_type = 'buy_to_cover';
   
   -- Should have 1 row with cover details
   ```

---

## Step 7: Test Leaderboard Storage

### During Contest:
```sql
-- Check real-time leaderboard storage
SELECT 
    is_running,
    jsonb_pretty(current_leaderboard) as live_leaderboard
FROM contest_state
WHERE is_running = true;

-- Should show top 100 users with current rankings
```

### After Contest Ends:
```sql
-- Check final results
SELECT 
    end_time,
    total_participants,
    jsonb_pretty(winner) as winner_details,
    jsonb_array_length(final_leaderboard) as total_in_leaderboard
FROM contest_results
ORDER BY end_time DESC
LIMIT 1;

-- Should show:
-- - Contest end timestamp
-- - Total participants
-- - Winner info (name, wealth, return %)
-- - Full final leaderboard (100 users)
```

---

## 🧪 Running Automated Tests

### All Tests:
```powershell
npm test
```

### Specific Test Suites:
```powershell
# Auto square-off tests (3 scenarios)
npm test auto-squareoff

# Contest reset tests (5 scenarios)
npm test contest-reset

# Portfolio calculations
npm test portfolio

# Trading logic
npm test trading

# Short sell logic
npm test shorts
```

### Test Coverage:
- ✅ Auto square-off with profit
- ✅ Auto square-off with loss
- ✅ Multiple shorts for same user
- ✅ Contest data cleanup
- ✅ Portfolio reset to 1M
- ✅ Short positions cleared
- ✅ Complete contest lifecycle
- ✅ User retention across contests

---

## 🔍 Troubleshooting

### Issue: Tests Failing

**Solution**:
```powershell
# Check environment variables
cat backend/.env

# Should have:
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_ANON_KEY=eyJ...
# SUPABASE_SERVICE_ROLE_KEY=eyJ...

# If missing, create .env file:
cp backend/.env.example backend/.env
# Then edit with your values
```

### Issue: Auto Square-Off Not Working

**Check**:
1. Are there active short positions?
   ```sql
   SELECT * FROM short_positions WHERE is_active = true;
   ```

2. Is contest running?
   ```sql
   SELECT is_running FROM contest_state ORDER BY created_at DESC LIMIT 1;
   ```

3. Check backend logs for errors

### Issue: Data Not Clearing

**Manual Clear**:
```sql
-- Run this in Supabase SQL Editor
SELECT * FROM cleanup_contest_data();

-- Or manually:
DELETE FROM trades;
DELETE FROM short_positions;
UPDATE portfolio SET 
    cash_balance = 1000000,
    holdings = '{}',
    total_wealth = 1000000,
    market_value = 0,
    total_pnl = 0;
```

### Issue: Leaderboard Not Updating

**Check**:
```sql
-- Verify column exists
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'contest_state' 
AND column_name = 'current_leaderboard';

-- If missing, run migrations again
```

---

## 📊 Performance Monitoring

### Check Database Load:
```sql
-- Active queries
SELECT 
    pid,
    now() - query_start as duration,
    query 
FROM pg_stat_activity 
WHERE state = 'active'
ORDER BY duration DESC;

-- Index usage
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as scans,
    idx_tup_read as tuples_read
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

### Monitor Backend:
```powershell
# In backend terminal, should see:
# - Candle generation logs every 5 seconds
# - Portfolio updates
# - Leaderboard updates every 30 seconds
# - WebSocket connections
```

---

## ✅ Success Criteria

Your platform is working correctly if:

- [x] Contest starts without errors
- [x] Users can buy/sell/short stocks
- [x] Portfolio updates in real-time
- [x] Leaderboard updates every 30s
- [x] Contest stops after 60 minutes
- [x] Auto square-off executes (logs show cash deduction)
- [x] Final leaderboard saved to DB
- [x] All data cleared after stop
- [x] New contest gives fresh 1M to all users
- [x] All tests pass

---

## 🎉 You're Ready!

**Your platform can now handle**:
- ✅ 200+ simultaneous users
- ✅ Real-time trading with proper PNL
- ✅ Automatic position square-off
- ✅ Contest data reset between sessions
- ✅ Persistent leaderboard storage
- ✅ Complete audit trail in database

**Need help?** Check `FIXES_APPLIED.md` for detailed documentation.

---

## 📞 Quick Commands Reference

```powershell
# Start backend
cd backend && npm run dev

# Start frontend
cd frontend && npm run dev

# Run tests
cd backend && npm test

# Clear all test data
# (Run in Supabase SQL Editor)
DELETE FROM trades WHERE user_email LIKE '%test%';
DELETE FROM portfolio WHERE user_email LIKE '%test%';

# Manual contest reset
SELECT * FROM cleanup_contest_data();

# Check leaderboard
SELECT * FROM top_performers LIMIT 10;

# View contest stats
SELECT * FROM contest_statistics;
```

Good luck with your trading platform! 🚀📈
