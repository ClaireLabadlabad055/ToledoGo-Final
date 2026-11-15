-- Updates the existing Pro plan price without changing current vendor access.

update public.vendor_subscription_plans
set monthly_price = 199.00,
    updated_at = now()
where id = 'pro';
