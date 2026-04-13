import { createClient } from '@supabase/supabase-js'
import { env, isSupabaseConfigured } from './env.js'

export function getSupabaseAdmin() {
  if (!isSupabaseConfigured()) {
    return null
  }

  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

export function getSupabaseAnon() {
  if (!(env.supabaseUrl && env.supabaseAnonKey)) {
    return null
  }

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
