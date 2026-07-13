import { createClient, SupabaseClient } from '@supabase/supabase-js';



let supabaseClient: SupabaseClient | null = null;

export function initSupabase(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  const SUPABASE_URL = process.env.SUPABASE_URL || '';
  const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('Supabase URL or Key is missing.');
    return null;
  }
  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
    return supabaseClient;
  } catch (error) {
    console.error('Error initializing Supabase:', error);
    return null;
  }
}

export async function getSupabaseData(): Promise<any[]> {
  const client = initSupabase();
  if (!client) return [];
  try {
    const pageSize = 1000;
    const allRows: any[] = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from('facturas_folios')
        .select('*')
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const page = data || [];
      allRows.push(...page);

      if (page.length < pageSize) break;
    }

    return allRows;
  } catch (error) {
    console.error('Error fetching Supabase data:', error);
    return [];
  }
}

export async function getDevolucionesData(): Promise<any[]> {
  const client = initSupabase();
  if (!client) return [];
  try {
    const { data, error } = await client.from('devoluciones').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching devoluciones data:', error);
    return [];
  }
}
