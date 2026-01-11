import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Create a Supabase admin client with service_role privileges.
 * Use this for server-side operations that need to bypass RLS.
 * NEVER expose this client to the browser.
 */
export function createAdminClient() {
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error('Supabase admin client not configured. Set SUPABASE_SERVICE_ROLE_KEY.');
    }

    return createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}

export function isAdminConfigured(): boolean {
    return !!(supabaseUrl && supabaseServiceKey);
}
