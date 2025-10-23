# 🐛 Troubleshooting: Trade Insertion JSONB Error

**Error**: `cannot cast jsonb object to type integer`

## 🔍 Problem Analysis

This error occurs when Supabase tries to insert a trade, but the `quantity` field (which should be an INTEGER) is being received as a JSONB object instead of a primitive number.

---

## ✅ Fixes Applied

### 1. Enhanced Type Coercion in Backend

**File**: `backend/index.js`

**Changes**:
- Added explicit `.valueOf()` calls to extract primitive values
- Added comprehensive type checking before database insert
- Enhanced logging to show actual types and values
- Wrapped quantity extraction in `Math.floor(Number().valueOf())`

**Code**:
```javascript
const safeQuantity = Math.floor(Number(numQuantity).valueOf());
const safePrice = parseFloat(Number(numPrice).toFixed(2));
const safeTotalAmount = parseFloat(Number(totalAmount).toFixed(2));
```

### 2. Added Debug Endpoint

**Endpoint**: `POST /api/debug/test-trade-insert`

Test trade insertion directly without going through the full trade flow.

**Usage**:
```bash
curl -X POST http://localhost:3002/api/debug/test-trade-insert \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

### 3. Database Verification Script

**File**: `backend/database_verification_trades.sql`

Run this in Supabase SQL Editor to:
- Verify trades table structure
- Check column data types
- Test direct INSERT
- Detect any triggers or RLS policies interfering

---

## 🔧 How to Fix

### Step 1: Restart Backend

```powershell
# Stop current backend (Ctrl+C)
# Then restart:
npm start
```

### Step 2: Run Database Verification

1. Open Supabase Dashboard
2. Go to SQL Editor
3. Copy contents of `backend/database_verification_trades.sql`
4. Run the script
5. Check output for:
   ```sql
   quantity  | integer | int4    ✅ CORRECT
   -- OR
   quantity  | jsonb   | jsonb   ❌ WRONG!
   ```

### Step 3: If Quantity Column is JSONB (Wrong!)

Run this fix in Supabase SQL Editor:

```sql
-- Backup existing data first!
CREATE TABLE trades_backup AS SELECT * FROM public.trades;

-- Fix the column type
ALTER TABLE public.trades 
ALTER COLUMN quantity TYPE integer 
USING CASE 
    WHEN pg_typeof(quantity) = 'jsonb'::regtype 
    THEN (quantity::text)::integer
    ELSE quantity::integer
END;

-- Verify fix
SELECT 
    column_name,
    data_type 
FROM information_schema.columns 
WHERE table_name = 'trades' 
AND column_name = 'quantity';
-- Should show: integer
```

### Step 4: Test Trade Insertion

#### Option A: Use Debug Endpoint

```bash
# Login as admin and get token
# Then test:
POST http://localhost:3002/api/debug/test-trade-insert
Authorization: Bearer <your-admin-token>
```

Should return:
```json
{
  "success": true,
  "message": "Trade insertion test passed"
}
```

#### Option B: Manual Test in Supabase

```sql
INSERT INTO public.trades (
    user_email,
    symbol,
    company_name,
    order_type,
    quantity,
    price,
    total_amount
) VALUES (
    'test@example.com',
    'TESTSTOCK',
    'Test Company',
    'buy',
    100,
    2500.50,
    250050.00
);

-- Check result
SELECT * FROM public.trades WHERE symbol = 'TESTSTOCK';

-- Clean up
DELETE FROM public.trades WHERE symbol = 'TESTSTOCK';
```

### Step 5: Test from Frontend

1. Start contest
2. Try to buy 1 share of any stock
3. Check backend logs:

**Expected (Success)**:
```
📥 Trade request received: {
  quantity: 1,
  quantityType: 'number',
  quantityValue: '1'
}
📝 Inserting trade with verified primitive types: {
  quantity: 'number',
  quantityValue: 1,
  isInteger: true
}
✅ Trade executed successfully: buy 1 ADANIENT @ ₹2499.7
```

**If Still Failing**:
```
❌ Trade insertion error: {
  code: '22023',
  message: 'cannot cast jsonb object to type integer'
}
```

---

## 🔍 Root Cause Investigation

If the issue persists, the problem might be:

### Issue 1: Database Column Type is Wrong

**Check**:
```sql
SELECT data_type FROM information_schema.columns 
WHERE table_name = 'trades' AND column_name = 'quantity';
```

**Should return**: `integer`

**If returns**: `jsonb` or anything else → Column type needs fixing

### Issue 2: Supabase Client Serialization Bug

**Check Supabase Version**:
```powershell
cd backend
npm list @supabase/supabase-js
```

**Expected**: `^2.x.x`

**If outdated**, update:
```powershell
npm install @supabase/supabase-js@latest
```

### Issue 3: Express Body Parser Issue

**Check if body-parser middleware is correct**:
```javascript
// In index.js, should have:
app.use(express.json());  // ✅ Correct

// Not this:
app.use(express.json({ strict: false }));  // ❌ Can cause type issues
```

### Issue 4: TypeScript/JavaScript Coercion

**The frontend sends**:
```typescript
quantity: number  // TypeScript type
```

**But JavaScript might wrap it as**:
```javascript
{ quantity: Number { 1 } }  // Number object instead of primitive
```

**Our fix**:
```javascript
Number(quantity).valueOf()  // Extracts primitive from Number object
```

---

## 🧪 Testing Checklist

- [ ] Backend starts without errors
- [ ] Run `database_verification_trades.sql` in Supabase
- [ ] `quantity` column is type `integer` (not `jsonb`)
- [ ] Test insert query works in Supabase SQL Editor
- [ ] Debug endpoint `/api/debug/test-trade-insert` returns success
- [ ] Buy trade from frontend succeeds
- [ ] Trade appears in database with correct types
- [ ] No JSONB cast errors in backend logs

---

## 📊 Verification Queries

### After Successful Trade:

```sql
-- Check latest trade
SELECT 
    id,
    symbol,
    pg_typeof(quantity) as quantity_type,
    quantity,
    pg_typeof(price) as price_type,
    price,
    created_at
FROM public.trades
ORDER BY created_at DESC
LIMIT 1;

-- Expected output:
-- quantity_type: integer  ✅
-- quantity: 1
-- price_type: numeric  ✅
-- price: 2499.70
```

### Check for Any JSONB Quantities:

```sql
SELECT 
    id,
    symbol,
    pg_typeof(quantity) as qty_type,
    quantity
FROM public.trades
WHERE pg_typeof(quantity)::text != 'integer';

-- Should return 0 rows!
```

---

## 🚨 Emergency Workaround

If nothing works and you need to trade immediately:

### Temporary Fix: Modify Database Schema

```sql
-- Change quantity to accept text, then cast
ALTER TABLE public.trades ALTER COLUMN quantity TYPE text;

-- Update backend to always convert to string
-- In index.js:
quantity: String(Math.floor(numQuantity))

-- NOT RECOMMENDED - This is a bandaid!
```

---

## ✅ Expected Behavior After Fix

### Backend Logs:
```
📥 Trade request received: {
  quantity: 1,
  quantityType: 'number',
  quantityValue: '1'
}
🔄 Executing buy: 1 ADANIENT @ ₹2499.7 (Total: ₹2499.7)
📝 Inserting trade with verified primitive types: {
  quantity: 'number',
  quantityValue: 1,
  isInteger: true,
  price: 'number',
  priceValue: 2499.7
}
✅ Trade executed successfully: buy 1 ADANIENT @ ₹2499.7
```

### Database Query:
```sql
SELECT * FROM trades ORDER BY created_at DESC LIMIT 1;

-- Returns:
-- quantity: 1 (integer)
-- price: 2499.70 (numeric)
-- No casting errors!
```

---

## 📞 If Still Broken

1. **Check Backend Environment**:
   ```powershell
   node --version  # Should be >= 18
   npm --version   # Should be >= 9
   ```

2. **Check Supabase Project**:
   - Is project active (not paused)?
   - Are you using correct URL/keys?
   - Does service role key have proper permissions?

3. **Check Network**:
   - Can backend reach Supabase?
   - Any firewall blocking database operations?

4. **Nuclear Option** - Recreate Trades Table:
   ```sql
   -- BACKUP FIRST!
   CREATE TABLE trades_backup AS SELECT * FROM public.trades;
   
   -- Drop and recreate
   DROP TABLE public.trades CASCADE;
   
   -- Run the CREATE TABLE from your schema file
   -- Then test again
   ```

---

## 📝 Summary

The fix involves:
1. ✅ Explicit type coercion using `.valueOf()`
2. ✅ Verification of column types in database
3. ✅ Enhanced logging to catch type mismatches
4. ✅ Debug endpoint for testing
5. ✅ Comprehensive error messages

**Most likely cause**: Database column was accidentally set to `jsonb` instead of `integer`.

**Quick fix**: Run the ALTER TABLE command in Step 3 above.

**Long-term fix**: All code changes are in place to prevent this in the future.

---

**Status**: 🔧 Fixes applied, ready for testing
