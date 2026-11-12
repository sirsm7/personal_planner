export async function onRequestGet(context) {
  const env = context.env || {};
  const supabaseUrl = typeof env.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim() : '';
  const supabaseAnonKey = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY.trim() : '';
  const supabaseSchema = typeof env.SUPABASE_SCHEMA === 'string' && env.SUPABASE_SCHEMA.trim() !== ''
    ? env.SUPABASE_SCHEMA.trim()
    : 'pap';
  const gasEndpointUrl = typeof env.GAS_ENDPOINT_URL === 'string' ? env.GAS_ENDPOINT_URL.trim() : '';

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate'
  };

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({
        error: 'Missing required Supabase environment variables.'
      }),
      {
        status: 500,
        headers
      }
    );
  }

  return new Response(
    JSON.stringify({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: supabaseAnonKey,
      SUPABASE_SCHEMA: supabaseSchema,
      GAS_ENDPOINT_URL: gasEndpointUrl
    }),
    {
      status: 200,
      headers
    }
  );
}