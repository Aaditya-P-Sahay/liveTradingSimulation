// backend/tests/setup.js
import { config } from 'dotenv';
import { beforeAll, afterAll } from 'vitest';

// Load environment variables
config();

// Verify required env vars are present
beforeAll(() => {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn('⚠️ Missing environment variables:', missing);
    console.warn('⚠️ Tests may fail. Please create a .env file with:');
    console.warn('   SUPABASE_URL=your_url');
    console.warn('   SUPABASE_SERVICE_ROLE_KEY=your_key');
  }
});

afterAll(() => {
  // Cleanup if needed
});