export type VendorSubscriptionTier = 'free' | 'pro';

export const hasActiveVendorPro = (
  tier: string | null | undefined,
  status: string | null | undefined,
  expiresAt: string | null | undefined,
) => tier === 'pro'
  && (status === 'active' || status === 'trial')
  && (!expiresAt || new Date(expiresAt).getTime() > Date.now());

export type VendorSubscriptionPlan = {
  id: VendorSubscriptionTier;
  name: string;
  monthlyPrice: number;
  maxItems: number;
  quickPos: boolean;
  priorityListing: boolean;
  batchCapacity: number;
  description: string;
};

export const vendorSubscriptionPlans: Record<VendorSubscriptionTier, VendorSubscriptionPlan> = {
  free: {
    id: 'free',
    name: 'Free / Basic',
    monthlyPrice: 0,
    maxItems: 5,
    quickPos: false,
    priorityListing: false,
    batchCapacity: 1,
    description: 'Best for home-based vendors with one active meetup schedule and a small catalog.',
  },
  pro: {
    id: 'pro',
    name: 'Pro / Storefront',
    monthlyPrice: 199,
    maxItems: 999,
    quickPos: true,
    priorityListing: true,
    batchCapacity: 8,
    description: 'Unlocks quick POS, unlimited listings, up to eight active meetup schedules, and marketplace visibility.',
  },
};

export const vendorSubscriptionTierDisplay: Record<VendorSubscriptionTier, string> = {
  free: 'Free / Basic',
  pro: 'Pro / Storefront',
};
