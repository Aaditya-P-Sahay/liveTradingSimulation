import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function testDatabase() {
  console.log('Testing database access...');
  
  try {
    // Test 1: Check if we can access users table
    console.log('\n1. Testing users table access...');
    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('*')
      .limit(1);
    
    if (usersError) {
      console.log('❌ Users table error:', usersError);
    } else {
      console.log('✅ Users table accessible, found', users?.length || 0, 'records');
    }

    // Test 2: Check contest_state table
    console.log('\n2. Testing contest_state table access...');
    const { data: contests, error: contestError } = await supabaseAdmin
      .from('contest_state')
      .select('*')
      .limit(1);
    
    if (contestError) {
      console.log('❌ Contest_state table error:', contestError);
    } else {
      console.log('✅ Contest_state table accessible, found', contests?.length || 0, 'records');
    }

    // Test 3: Check LALAJI table
    console.log('\n3. Testing LALAJI table access...');
    const { data: lalaji, error: lalajiError } = await supabaseAdmin
      .from('LALAJI')
      .select('symbol')
      .limit(1);
    
    if (lalajiError) {
      console.log('❌ LALAJI table error:', lalajiError);
    } else {
      console.log('✅ LALAJI table accessible, found', lalaji?.length || 0, 'records');
    }

  } catch (error) {
    console.log('❌ Connection error:', error);
  }
}

testDatabase();