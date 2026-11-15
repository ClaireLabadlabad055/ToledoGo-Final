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

const isUuid = (value: unknown): value is string =>
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return jsonResponse({ error: 'Authentication required' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Push notification service is not configured' }, 500);
  }

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization },
  });
  if (!authResponse.ok) return jsonResponse({ error: 'Invalid or expired session' }, 401);
  const user = await authResponse.json();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body' }, 400);
  }

  const event = body.event;
  const expoPushToken = typeof body.expo_push_token === 'string' ? body.expo_push_token : '';
  const isExpoToken = /^(Expo|Exponent)PushToken\[[^\]]+\]$/.test(expoPushToken);
  const restHeaders = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
  const tokenUrl = `${supabaseUrl}/rest/v1/device_push_tokens`;

  if (event === 'register') {
    if (!isExpoToken) return jsonResponse({ error: 'Invalid Expo push token' }, 400);
    const response = await fetch(`${tokenUrl}?on_conflict=expo_push_token`, {
      method: 'POST',
      headers: {
        ...restHeaders,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ expo_push_token: expoPushToken, user_id: user.id, updated_at: new Date().toISOString() }),
    });
    if (!response.ok) return jsonResponse({ error: 'Could not register this device for notifications' }, 502);
    return jsonResponse({ registered: true });
  }

  if (event === 'unregister') {
    if (!isExpoToken) return jsonResponse({ error: 'Invalid Expo push token' }, 400);
    const response = await fetch(
      `${tokenUrl}?user_id=eq.${encodeURIComponent(user.id)}&expo_push_token=eq.${encodeURIComponent(expoPushToken)}`,
      { method: 'DELETE', headers: { ...restHeaders, Prefer: 'return=minimal' } },
    );
    if (!response.ok) return jsonResponse({ error: 'Could not unregister this device' }, 502);
    return jsonResponse({ unregistered: true });
  }

  let recipientUserId: string | null = null;
  let title = '';
  let message = '';
  let notificationData: Record<string, string> = {};

  if (event === 'account_approved') {
    if (user.app_metadata?.role !== 'admin') return jsonResponse({ error: 'Administrator access required' }, 403);
    const targetUserId = body.user_id;
    const accountType = body.account_type;
    if (!isUuid(targetUserId) || !['vendors', 'customers'].includes(String(accountType))) {
      return jsonResponse({ error: 'Valid user ID and account type are required' }, 400);
    }

    const profileTable = accountType === 'vendors' ? 'vendors' : 'customers';
    const profileResponse = await fetch(
      `${supabaseUrl}/rest/v1/${profileTable}?id=eq.${targetUserId}&select=id,is_verified${profileTable === 'vendors' ? ',verification_status' : ''}`,
      { headers: restHeaders },
    );
    if (!profileResponse.ok) return jsonResponse({ error: 'Could not verify account approval' }, 502);
    const profiles = await profileResponse.json();
    const approved = profiles[0]?.is_verified === true
      && (profileTable !== 'vendors' || profiles[0]?.verification_status === 'approved');
    if (!approved) return jsonResponse({ error: 'Account is not approved' }, 409);

    recipientUserId = targetUserId;
    title = 'Your ToledoGo account is approved';
    message = 'Your account has been approved. You can now sign in and use ToledoGo.';
    notificationData = { type: 'account_approved' };
  } else if (event === 'order_ready') {
    if (!isUuid(body.order_id)) return jsonResponse({ error: 'A valid order ID is required' }, 400);
    const orderResponse = await fetch(
      `${supabaseUrl}/rest/v1/orders?id=eq.${body.order_id}&select=id,vendor_id,customer_id,status`,
      { headers: restHeaders },
    );
    if (!orderResponse.ok) return jsonResponse({ error: 'Could not verify order status' }, 502);
    const orders = await orderResponse.json();
    const order = orders[0];
    if (!order || order.vendor_id !== user.id || order.status !== 'ready') {
      return jsonResponse({ error: 'Only the order vendor can notify its customer when the order is ready' }, 403);
    }

    recipientUserId = order.customer_id;
    title = 'Your order is ready for pickup';
    message = 'Your ToledoGo order is ready. Please check My Orders for pickup details.';
    notificationData = { type: 'order_ready', orderId: order.id };
  } else {
    return jsonResponse({ error: 'Unsupported push notification event' }, 400);
  }

  const recipientResponse = await fetch(
    `${tokenUrl}?user_id=eq.${recipientUserId}&select=expo_push_token`,
    { headers: restHeaders },
  );
  if (!recipientResponse.ok) return jsonResponse({ error: 'Could not load notification devices' }, 502);
  const registeredDevices = await recipientResponse.json();
  const tokens = registeredDevices.map((device: { expo_push_token: string }) => device.expo_push_token);
  if (!tokens.length) return jsonResponse({ sent: 0, reason: 'No registered devices for this user' });

  let sent = 0;
  const invalidTokens: string[] = [];
  for (let offset = 0; offset < tokens.length; offset += 100) {
    const chunk = tokens.slice(offset, offset + 100);
    const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunk.map((to: string) => ({
        to,
        title,
        body: message,
        data: notificationData,
        sound: 'default',
        channelId: 'default',
      }))),
    });
    if (!pushResponse.ok) return jsonResponse({ error: 'Expo could not deliver the notification request' }, 502);
    const result = await pushResponse.json();
    for (const [index, ticket] of (result.data ?? []).entries()) {
      if (ticket.status === 'ok') {
        sent += 1;
      } else if (ticket.details?.error === 'DeviceNotRegistered') {
        invalidTokens.push(chunk[index]);
      } else {
        console.error('Expo push ticket failed:', ticket.message ?? ticket.details?.error ?? 'Unknown error');
      }
    }
  }

  if (invalidTokens.length) {
    const cleanupResponse = await fetch(`${tokenUrl}?expo_push_token=in.(${invalidTokens.map(encodeURIComponent).join(',')})`, {
      method: 'DELETE',
      headers: { ...restHeaders, Prefer: 'return=minimal' },
    });
    if (!cleanupResponse.ok) console.error('Could not remove expired Expo push tokens.');
  }

  if (sent === 0) {
    return jsonResponse({ error: 'Expo did not accept any notifications for delivery', sent, failed: tokens.length }, 502);
  }
  return jsonResponse({ sent, failed: tokens.length - sent });
});
