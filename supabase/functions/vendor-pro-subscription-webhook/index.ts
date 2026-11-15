export {};

type DenoRuntime = {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const denoRuntime = (globalThis as typeof globalThis & { Deno: DenoRuntime }).Deno;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const constantTimeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const verifyPayMongoSignature = async (rawBody: string, signatureHeader: string, secret: string, livemode: boolean) => {
  const parts = signatureHeader.split(',').map((part) => part.trim().split('=', 2));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signature = parts.find(([key]) => key === (livemode ? 'li' : 'te'))?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return constantTimeEqual(signature.toLowerCase(), expected);
};

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
    throw new Error('Could not safely apply the confirmed Pro payment.');
  }
  return await response.json();
};

denoRuntime.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const webhookSecret = denoRuntime.env.get('PAYMONGO_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('PAYMONGO_WEBHOOK_SECRET is not configured.');
    return jsonResponse({ error: 'Webhook is not configured.' }, 500);
  }

  const signature = request.headers.get('Paymongo-Signature');
  if (!signature) return jsonResponse({ error: 'Missing PayMongo signature.' }, 400);

  const rawBody = await request.text();
  try {
    const event = JSON.parse(rawBody);
    const data = event?.data;
    const dataAttributes = data?.attributes;
    const directCheckoutSession = event?.type === 'checkout_session' && event?.attributes
      ? event
      : null;
    const session = data?.data
      ?? dataAttributes?.data
      ?? directCheckoutSession;
    const eventType = dataAttributes?.type
      ?? data?.type
      ?? (directCheckoutSession ? 'checkout_session.payment.paid' : null);
    if (eventType !== 'checkout_session.payment.paid') {
      console.error('Unexpected PayMongo webhook event type or payload layout:', {
        eventType: typeof eventType === 'string' ? eventType : null,
        topLevelKeys: Object.keys(event),
        dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
        dataAttributeKeys: dataAttributes && typeof dataAttributes === 'object'
          ? Object.keys(dataAttributes)
          : [],
      });
      return jsonResponse({ error: 'Unexpected PayMongo webhook event type or payload layout.' }, 400);
    }
    if (
      (dataAttributes?.resource ?? data?.resource ?? session?.type) !== 'checkout_session'
      || typeof session?.id !== 'string'
      || !session.attributes
    ) {
      console.error('PayMongo paid-checkout event has an unexpected payload shape:', {
        eventType,
        resource: data?.resource,
        sessionIdType: typeof session?.id,
        hasAttributes: Boolean(session?.attributes),
        topLevelKeys: Object.keys(event),
        dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
      });
      return jsonResponse({ error: 'Malformed paid checkout event.' }, 400);
    }

    if (!(await verifyPayMongoSignature(
      rawBody,
      signature,
      webhookSecret,
      dataAttributes?.livemode === true
        || data?.livemode === true
        || session.attributes.livemode === true,
    ))) {
      return jsonResponse({ error: 'Invalid PayMongo signature.' }, 400);
    }

    const attributes = session.attributes;
    const metadata = attributes.metadata;
    const vendorId = metadata?.vendor_id;
    const reference = attributes.reference_number;
    const payments = attributes.payments;
    const paidPayment = Array.isArray(payments)
      ? payments.find((payment: Record<string, any>) => payment?.attributes?.status === 'paid')
      : null;
    const paymentAttributes = paidPayment?.attributes;

    if (
      typeof vendorId !== 'string'
      || metadata?.plan !== 'pro'
      || typeof reference !== 'string'
      || metadata?.reference !== reference
      || typeof paidPayment?.id !== 'string'
      || paymentAttributes?.amount !== 19900
      || paymentAttributes?.currency?.toLowerCase() !== 'php'
    ) {
      throw new Error('Paid checkout does not match the configured PHP 199 Pro month.');
    }

    const eventId = typeof event?.id === 'string'
      ? event.id
      : typeof data?.id === 'string' && data.id !== session.id
        ? data.id
      : `paymongo:${session.id}:${paidPayment.id}`;
    const applied = await callServiceRpc('apply_vendor_pro_payment', {
      p_event_id: eventId,
      p_vendor_id: vendorId,
      p_session_id: session.id,
      p_reference: reference,
    });
    return jsonResponse({ received: true, applied: applied === true });
  } catch (error) {
    console.error('PayMongo webhook processing failed:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unable to process PayMongo webhook.',
    }, 500);
  }
});
