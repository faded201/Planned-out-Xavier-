export type AppPlan = 'free' | 'pro' | 'business';

export type PlanAccess = {
  premiumUi: boolean;
  tax: boolean;
  invoices: boolean;
  crm: boolean;
  customCrm: boolean;
  ndis: boolean;
  cloudVoice: boolean;
};

export const planAccess: Record<AppPlan, PlanAccess> = {
  free: { premiumUi: false, tax: false, invoices: false, crm: false, customCrm: false, ndis: false, cloudVoice: false },
  pro: { premiumUi: true, tax: true, invoices: true, crm: false, customCrm: false, ndis: false, cloudVoice: true },
  business: { premiumUi: true, tax: true, invoices: true, crm: true, customCrm: true, ndis: true, cloudVoice: true },
};

export function minimumPlanForModule(module: string): 'pro' | 'business' | null {
  if (module === 'tax' || module === 'invoice') return 'pro';
  if (module === 'crm' || module === 'crm-schema' || module === 'ndis') return 'business';
  return null;
}

export function canUsePaidModule(plan: AppPlan, module: string): boolean {
  const required = minimumPlanForModule(module);
  if (!required) return true;
  if (required === 'pro') return plan === 'pro' || plan === 'business';
  return plan === 'business';
}
