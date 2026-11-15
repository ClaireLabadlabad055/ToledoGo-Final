export {};

type DenoRuntime = {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const denoRuntime = (globalThis as typeof globalThis & { Deno: DenoRuntime }).Deno;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const callServiceRpc = async (functionName: string, body: Record<string, unknown>) => {
  const supabaseUrl = denoRuntime.env.get('SUPABASE_URL');
  const serviceKey = denoRuntime.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase service-role credentials are not configured.');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 240);
    console.error(`Supabase ${functionName} RPC failed:`, response.status, details);
    throw new Error('The payment service could not safely update checkout state.');
  }
  return await response.json();
};

const getAuthenticatedUser = async (authorization: string) => {
  const supabaseUrl = denoRuntime.env.get('SUPABASE_URL');
  const supabaseAnonKey = denoRuntime.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase authentication is not configured.');
  }
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseAnonKey, Authorization: authorization },
  });
  if (!response.ok) return null;
  return await response.json();
};

const getVendor = async (userId: string, authorization: string) => {
  const supabaseUrl = denoRuntime.env.get('SUPABASE_URL');
  const supabaseAnonKey = denoRuntime.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase database access is not configured.');
  }
  const query = new URLSearchParams({
    id: `eq.${userId}`,
    select: 'id,is_verified,subscription_tier,subscription_status,subscription_expires_at',
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/vendors?${query}`, {
    headers: { apikey: supabaseAnonKey, Authorization: authorization },
  });
  if (!response.ok) throw new Error('Could not verify the vendor account.');
  const rows = await response.json();
  return Array.isArray(rows) ? rows[0] : null;
};

const createPayMongoCheckout = async (
  secretKey: string,
  vendorId: string,
  reference: string,
  successUrl: string,
  cancelUrl: string,
) => {
  const response = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${secretKey}:`)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [{
            name: 'ToledoGo Pro — 1 month',
            amount: 19900,
            currency: 'PHP',
            quantity: 1,
          }],
          payment_method_types: ['gcash', 'qrph'],
          success_url: successUrl,
          cancel_url: cancelUrl,
          reference_number: reference,
          send_email_receipt: true,
          metadata: { vendor_id: vendorId, plan: 'pro', reference },
        },
      },
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    console.error('PayMongo checkout creation failed:', response.status, payload);
    const message = payload?.errors?.[0]?.detail;
    throw new Error(typeof message === 'string' ? message : 'PayMongo could not create the checkout session.');
  }
  const session = payload?.data;
  const checkoutUrl = session?.attributes?.checkout_url;
  if (typeof session?.id !== 'string' || typeof checkoutUrl !== 'string') {
    throw new Error('PayMongo did not return a valid checkout session.');
  }
  return { sessionId: session.id as string, checkoutUrl: checkoutUrl as string };
};

denoRuntime.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing authorization' }, 401);
  }

  let reservedVendorId: string | null = null;
  let checkoutReference: string | null = null;
  try {
    const user = await getAuthenticatedUser(authorization);
    if (typeof user?.id !== 'string') return jsonResponse({ error: 'Unauthorized' }, 401);

    const vendor = await getVendor(user.id, authorization);
    if (!vendor) return jsonResponse({ error: 'Vendor profile not found.' }, 404);
    if (vendor.is_verified !== true) {
      return jsonResponse({ error: 'Your vendor account must be verified before upgrading.' }, 403);
    }

    const secretKey = denoRuntime.env.get('PAYMONGO_SECRET_KEY');
    if (!secretKey) throw new Error('PayMongo is not configured. Set PAYMONGO_SECRET_KEY.');
    const successUrl = denoRuntime.env.get('PAYMONGO_SUCCESS_URL');
    const cancelUrl = denoRuntime.env.get('PAYMONGO_CANCEL_URL');
    if (!successUrl || !cancelUrl) {
      throw new Error('Set PAYMONGO_SUCCESS_URL and PAYMONGO_CANCEL_URL to complete HTTPS return URLs.');
    }
    for (const returnUrl of [successUrl, cancelUrl]) {
      if (new URL(returnUrl).protocol !== 'https:') {
        throw new Error('PayMongo success and cancel URLs must use HTTPS.');
      }
    }

    const reserved = await callServiceRpc('reserve_vendor_pro_checkout', { p_vendor_id: user.id });
    if (reserved !== true) {
      return jsonResponse({ error: 'A checkout is already in progress. Complete it before starting another.' }, 409);
    }
    reservedVendorId = user.id;
    checkoutReference = `TGPRO-${crypto.randomUUID()}`;
    const checkoutCancelUrl = new URL(cancelUrl);
    checkoutCancelUrl.searchParams.set('reference', checkoutReference);

    const checkout = await createPayMongoCheckout(
      secretKey,
      user.id,
      checkoutReference,
      successUrl,
      checkoutCancelUrl.toString(),
    );
    const saved = await callServiceRpc('set_vendor_pro_checkout_session', {
      p_vendor_id: user.id,
      p_session_id: checkout.sessionId,
      p_reference: checkoutReference,
    });
    if (saved !== true) throw new Error('Could not safely link the checkout to this vendor.');

    return jsonResponse({
      ok: true,
      checkout_url: checkout.checkoutUrl,
      session_id: checkout.sessionId,
      reference: checkoutReference,
    });
  } catch (error) {
    if (reservedVendorId) {
      try {
        await callServiceRpc('release_vendor_pro_checkout', {
          p_vendor_id: reservedVendorId,
          p_reference: checkoutReference,
        });
      } catch (releaseError) {
        console.error('Could not release failed checkout reservation:', releaseError);
      }
    }
    console.error('Pro checkout request failed:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unable to process the Pro checkout request.',
    }, 500);
  }
});
