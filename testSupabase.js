import { supabase } from './lib/supabase.js'

async function testConnection() {
  const { data, error } = await supabase.from('programs').select('*')
  console.log('Data:', data)
  console.log('Error:', error)
}

testConnection()
