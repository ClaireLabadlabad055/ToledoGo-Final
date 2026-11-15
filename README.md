# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

### Supabase deployment order

Run the SQL migrations in this order in a staging project first:

1. `supabase/00-base-schema.sql`
2. `supabase/meetup-hubs.sql`
3. `supabase/vendor-verification.sql`
4. `supabase/menus.sql`
5. `supabase/orders.sql`
6. `supabase/vendor-subscriptions.sql`
7. `supabase/batch-scheduling.sql`
8. `supabase/loyalty-reviews.sql`
9. `supabase/messaging.sql`
10. `supabase/admin-ledger-moderation.sql`
11. `supabase/monetization.sql`
12. `supabase/admin-policies.sql`
13. `supabase/deployment-hardening.sql`
14. `supabase/pro-subscription-hardening.sql`
15. `supabase/paymongo-pro-billing.sql`
16. `supabase/ai-features.sql`
17. `supabase/pro-price-adjustment-199.sql`
18. `supabase/push-notifications.sql`
19. `supabase/vendor-managed-refunds.sql`
20. `supabase/order-chat-cards.sql`
21. `supabase/fix-daily-login-coin-reward.sql`
22. `supabase/fix-vendor-business-id.sql`
23. `supabase/general-customer-complaints.sql`
24. `supabase/general-customer-feedback.sql`
25. `supabase/customer-verification.sql`

The hardening migration must be applied before production traffic. Test it with separate customer, vendor, admin, and unauthenticated accounts.

For an existing Supabase project, do not rerun the full setup list. Apply only a reviewed feature migration in staging after checking its compatibility with that project's existing column types.

The vendor-managed refund migration depends on `orders.sql`, `messaging.sql`, and `deployment-hardening.sql`. For cancelled GCash/Maya orders with a payment reference, the vendor has three calendar days to confirm the refund request. Confirmation creates an automated ToledoGo chat update asking the customer to enter their e-wallet name and Philippine mobile number in the order pass. After submission, the vendor has three calendar days to send the refund; the chat tells the customer to wait and the order shows the expected deadline. Vendors record the transfer reference after sending and can optionally upload transfer-image proof. Evidence is stored in the private `refund-proof` bucket. ToledoGo does not move money or independently verify a transfer or proof image. Cash-on-pickup orders are not charged before collection, so cancelling one does not create a cash refund; any redeemed loyalty coins are restored separately. Customers can report a vendor who misses the confirmation deadline, a refund that passes its transfer deadline, or a refund marked sent but not received. Admin → Refund Monitoring lists active refunds, overdue deadlines, customer reports, and vendor-recorded settlement times so administrators can follow up and manually pause a vendor storefront when warranted. A recorded settlement time or transfer reference is not independent proof that the external wallet transfer succeeded. Never request or share a wallet PIN or OTP. Direct vendor refunds are not added to future payout deductions, because the cancelled order is excluded from completed sales.

For an existing deployment, run `supabase/customer-refund-proof-access.sql` after `vendor-managed-refunds.sql` and before deploying the receipt-view update. It allows a customer to view only the transfer proof attached to their own settled refund; the refund-proof bucket remains private.

For an existing deployment, if refund confirmation reports an error involving `get_or_create_vendor_refund_conversation`, says conversation participants/order cannot be changed, or reports that `left(uuid, integer)` does not exist, run `supabase/fix-refund-conversation-uuid.sql` in the Supabase SQL Editor after the vendor-managed refund migration. It updates the helper to reuse existing conversations without changing their protected fields, adds the UUID-signature wrapper when needed, and casts UUID order IDs before formatting; it is safe to rerun.

For an existing deployment that credits a cash-on-pickup order total when cancelled, run `supabase/fix-cash-on-pickup-cancellation.sql` in the Supabase SQL Editor after `vendor-managed-refunds.sql`. This replaces only the cancellation trigger function and preserves stock and redeemed-loyalty-coin restoration. It does not reverse cash already credited by an earlier cancellation; review any such wallet transaction separately before making a manual adjustment.

For an existing deployment, run `supabase/fix-daily-login-coin-reward.sql` in the Supabase SQL Editor after `loyalty-reviews.sql`. It changes the daily login reward from 0.5 to 0.1 ToledoCoin without rerunning the full loyalty setup. The existing rule remains one reward per customer per calendar day, on the first dashboard open that day.

For an existing deployment, run `supabase/fix-vendor-business-id.sql` before deploying the vendor registration update. New home-based and physical-store vendor applications must upload an owner government ID and a separate business registration document (DTI, SEC, or CDA). Physical stores must also submit a permit and store photo. Admin approval screens display the business document for review; existing vendors are not automatically required to resubmit it.

For an existing deployment, run `supabase/general-customer-complaints.sql` after `admin-ledger-moderation.sql` and before deploying the complaint form. It extends the existing reports queue to accept customer complaints not tied to an order, review, or vendor. Customers submit from Help & Support; admins review, resolve, or dismiss them in Admin → Moderation → Reports.

For an existing deployment, run `supabase/general-customer-feedback.sql` after `admin-ledger-moderation.sql` and before deploying the general feedback form. Customers can submit a 1–5 star ToledoGo app rating and an optional comment from Help & Support. Admins review submissions in Admin → Moderation → Feedback.

`order-chat-cards.sql` makes a private customer/vendor conversation and posts an order card when the order is placed. The card shows order details and refund actions; the pickup QR remains available only in the customer's authenticated order pass.

### Registration email verification and admin approval

Customer registration uses email and password but does not wait for an email confirmation. Supabase must have **Confirm email** disabled for the project; after signup, ToledoGo uploads at least one government-issued ID image to the private `customer-verification` bucket and creates the customer's pending approval profile. Admins can view the ID from Admin → Approvals. The existing email confirmation screen and route remain available for older links, but this customer flow does not navigate there.

In Supabase Authentication settings, turn off **Confirm email** for this demo flow. This is a project-wide setting and also means vendor accounts will not be required to confirm their email; vendor registration still collects its verification documents and waits for admin approval. The existing `toledogo://auth/confirm` redirect remains configured for legacy confirmation links and other supported auth flows. Run `supabase/customer-verification.sql` after `supabase/admin-policies.sql` before deploying this customer ID upload flow. Customer ID files are private and readable only by admins through the approval screen. Decide and communicate a retention period for these sensitive documents before production use.

If Supabase accepts a signup but no confirmation message arrives, check **Authentication → Logs** for the signup/email event, verify custom SMTP is configured with a verified sender, and check spam. A successful signup API response alone does not guarantee delivery by Supabase's restricted default mail service. Customer profiles are created after confirmation and must match the `customers` table schema so they appear in Admin → Approvals.

Password recovery uses the `toledogo://reset-password` deep link. Add it to the same Supabase redirect URL allow list. When testing in Expo Go, also allow the current development URL generated by `Linking.createURL('reset-password')` and request a fresh email after starting the development server. For reliable recovery-link testing, use an installed ToledoGo development build and open the email link on that device.

Email verification confirms control of the email address; it does not approve an application. Vendor and customer approval remains a separate admin action, and access must continue to be governed by database approval state. Deploy `send-status-email` and configure Resend as described below so admins can notify applicants when their decision is recorded.

Pickup windows are scheduled in 30-minute blocks. Vendors set a maximum order count per window; meet-up windows can include a destination landmark. The vendor queue and batch summary prioritize pickup time, and completed windows disappear from customer menus after their pickup time.

Before release, start local Supabase and run `npx supabase db lint --local`, then verify the same migrations in staging. Do not use production credentials in the mobile app.

### Pro payments and PayMongo

Pro is a manually renewed, one-month pass for PHP 199. Vendors can view their current plan and expiry date, and renew through the in-app subscription screen. Vendors pay through PayMongo Hosted Checkout using GCash or QR Ph; there is no automatic charge, trial, or Stripe billing portal. Pro activates only after the signed `checkout_session.payment.paid` webhook has been validated. Returning to the app from Checkout is informational and never grants access by itself. Renewing early adds one month to the current expiry date.

Vendor registration offers Free / Basic and Pro / Storefront plan choices. New vendors start on Free while awaiting admin approval; selecting Pro during registration does not charge the applicant. After approval, the vendor can purchase Pro for PHP 199 per month from the Subscription screen.

Apply `supabase/paymongo-pro-billing.sql` after `supabase/pro-subscription-hardening.sql`. The original hardening migration is retained because it creates the subscription columns and entitlement guards used by existing Pro feature limits. The new migration adds PayMongo checkout state, payment-event idempotency, and service-role-only RPCs. Do not grant authenticated clients permission to update subscription fields.

After applying the previous migrations, run `supabase/pro-price-adjustment-199.sql` to update the existing plan catalog price. Existing Pro access and expiry dates are not changed. The checkout function and webhook validate the PHP 199 amount, so deploy both together.

Configure test-mode credentials as Supabase Edge Function secrets; never put PayMongo or service-role secrets in the app:

```bash
supabase secrets set PAYMONGO_SECRET_KEY=sk_test_replace_me PAYMONGO_WEBHOOK_SECRET=replace_with_endpoint_signing_secret PAYMONGO_SUCCESS_URL=https://your-domain.example/payment-success PAYMONGO_CANCEL_URL=https://your-domain.example/payment-cancelled
```

Replace both example return URLs with complete HTTPS URLs on a domain you control. When the customer returns to the app, its dashboard refreshes; the return page itself does not confirm payment.

Deploy checkout with JWT verification enabled and the webhook without Supabase JWT verification; the webhook validates PayMongo's `Paymongo-Signature` header itself:

```bash
supabase functions deploy vendor-pro-upgrade
supabase functions deploy vendor-pro-subscription-webhook --no-verify-jwt
supabase functions deploy vendor-pro-payment-return --no-verify-jwt
```

In the PayMongo dashboard, configure a webhook endpoint pointing to `vendor-pro-subscription-webhook` and subscribe it to `checkout_session.payment.paid`. Store that endpoint's signing secret as `PAYMONGO_WEBHOOK_SECRET`. Confirm GCash and QR Ph are enabled for the merchant account and available in test mode. After testing, use separate live-mode keys and webhook secret only after completing PayMongo's merchant verification and enabling the required payment methods.

PayMongo success/cancel redirects use the public HTTPS `vendor-pro-payment-return` Edge Function URLs (with `status=success` and `status=cancelled`). The function offers a deep link back to the Expo app; it does not verify payment or grant Pro.

Disable the old Stripe webhook endpoint and remove the Stripe secrets once the PayMongo deployment is ready. Existing Stripe Sandbox subscriptions are not migrated; manage or cancel those separately in Stripe. PayMongo does not automatically collect a renewal: vendors must use **Renew Pro for ₱199** each month. Unpaid or cancelled Checkout sessions do not activate Pro.

Test a successful GCash/QR Ph checkout, cancellation, invalid signature, duplicate webhook, mismatched vendor/session/reference, early renewal/expiry behavior, and direct attempts to modify subscription fields or exceed Free plan menu/batch/POS limits. In QR Ph test mode, follow PayMongo's test instructions and never scan/pay a QR with a real banking app. Confirm that webhook delivery—not the browser redirect—changes the vendor's Pro entitlement.

### Phone push notifications

Push notifications are sent when an admin approves a customer/vendor account and when a vendor marks an order ready for pickup. The app registers the signed-in device with Expo; push tokens are stored in `device_push_tokens`, which is only accessible to the trusted Edge Function.

Apply `supabase/push-notifications.sql`, then deploy the authenticated Edge Function:

```bash
supabase functions deploy push-notifications
```

Build and install a development or preview app on a physical phone; a native rebuild is required after adding `expo-notifications`. Configure Android FCM v1 credentials or iOS APNs credentials through EAS before building. On first sign-in, allow ToledoGo to send notifications. Test account approval with a separate pending account that has signed in on another phone, then approve it from the admin account. Test order readiness by placing an order as a customer and marking it ready from the vendor account. Try both while ToledoGo is open and while it is in the background. Push delivery requires internet access and valid EAS platform credentials; users who deny notification permission will not receive phone alerts, but can still see in-app order notifications. The account being notified must have signed in at least once on a physical device after the push function is deployed so ToledoGo can register its push token.

For Android development testing, build with the existing development profile and install the resulting build:

```bash
eas build --profile development --platform android
```

Do not test push delivery in a web browser or emulator; use a physical device with the installed native build.

### AI menu-description assistance and customer help

The vendor menu editor can request a Gemini-generated description using the dish name, category, and any ingredients/details the vendor supplies. The vendor must confirm they are 18 or older the first time they request a suggestion; vendor registration itself is not age-restricted. The confirmation is a self-attestation, not age or identity verification. Vendors must review generated text for accuracy before saving it.

Only the vendor-submitted menu details are sent to the Gemini API. The customer Help Assistant uses built-in FAQ answers locally and does not send customer questions to an AI provider. Review Google's current Gemini API terms for the intended audience and deployment before enabling this feature; an adult confirmation for vendors does not by itself establish compliance if the application may be used by minors.

Apply `supabase/ai-features.sql` after the other listed migrations. Create a Gemini API key in Google AI Studio and store it as a Supabase Edge Function secret; do not add it to the app or commit it:

```bash
supabase secrets set GEMINI_API_KEY=replace_with_your_gemini_api_key
supabase functions deploy vendor-ai-assistant
```

Keep JWT verification enabled for `vendor-ai-assistant`. The function independently verifies the authenticated vendor, approval status, and adult self-attestation before calling Gemini. The customer FAQ screen is available from the customer profile's Help & support entry and requires no AI credentials or function deployment.

### Status notification emails

Approval and rejection emails are sent by the `send-status-email` Supabase Edge Function. Deploy it with the Supabase CLI, then configure the Resend credentials as Supabase secrets:

```bash
supabase functions deploy send-status-email
supabase secrets set RESEND_API_KEY=re_your_key EMAIL_FROM="ToledoGo <no-reply@your-verified-domain.com>"
```

The sender domain must be verified in Resend before emails can be delivered.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
