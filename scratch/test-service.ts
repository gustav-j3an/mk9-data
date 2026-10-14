import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { fetchSystemSettings } from '../src/lib/systemSettings';

async function testService() {
  console.log('Testing fetchSystemSettings...');
  const state = await fetchSystemSettings();
  console.log('fetchSystemSettings result:', state);
}

testService();
