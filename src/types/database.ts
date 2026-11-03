// Hand-maintained mirror of supabase/migrations. Regenerate with
// `npx supabase gen types typescript --project-id <id> > src/types/database.ts`
// once the project is linked.

export type CompanyPlan = 'free' | 'starter' | 'growth' | 'enterprise';
export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';
export type LocationKind = 'warehouse' | 'shelf' | 'store' | 'transit' | 'other';
export type CheckStatus = 'pending' | 'analyzing' | 'completed' | 'failed';
export type MatchStatus = 'match' | 'partial' | 'mismatch' | 'unknown';

export type Company = {
  id: string;
  name: string;
  slug: string;
  plan: CompanyPlan;
  country: string;
  currency: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  updated_at: string;
};

export type UserProfile = {
  id: string;
  company_id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

export type Location = {
  id: string;
  company_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  kind: LocationKind;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: string;
  company_id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
};

export type Product = {
  id: string;
  company_id: string;
  category_id: string | null;
  sku: string;
  barcode: string | null;
  name: string;
  brand: string | null;
  variant: string | null;
  description: string | null;
  unit: string;
  image_url: string | null;
  visual_notes: string | null;
  reorder_point: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type InventoryLevel = {
  id: string;
  company_id: string;
  product_id: string;
  location_id: string;
  quantity: number;
  counted_at: string | null;
  updated_at: string;
};

export type InventoryCheck = {
  id: string;
  company_id: string;
  location_id: string;
  created_by: string | null;
  status: CheckStatus;
  image_path: string;
  model: string | null;
  summary: string | null;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  started_at: string;
  completed_at: string | null;
};

export type InventoryCheckItem = {
  id: string;
  company_id: string;
  check_id: string;
  product_id: string | null;
  product_label: string;
  expected_qty: number | null;
  detected_qty: number | null;
  confidence: number | null;
  status: MatchStatus;
  needs_barcode: boolean;
  notes: string | null;
  created_at: string;
};

/** `public.product_stock` — products with quantities rolled up across locations. */
export type ProductStock = {
  product_id: string;
  company_id: string;
  sku: string;
  name: string;
  brand: string | null;
  variant: string | null;
  unit: string;
  barcode: string | null;
  image_url: string | null;
  reorder_point: number;
  active: boolean;
  category_id: string | null;
  category_name: string | null;
  total_quantity: number;
  stocked_locations: number;
  stock_updated_at: string | null;
  is_low_stock: boolean;
};

/** `public.check_summary` — one row per verification run with its tally. */
export type CheckSummary = {
  id: string;
  company_id: string;
  location_id: string;
  location_code: string;
  location_name: string;
  status: CheckStatus;
  summary: string | null;
  image_path: string;
  started_at: string;
  completed_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  item_count: number;
  match_count: number;
  partial_count: number;
  mismatch_count: number;
  needs_barcode_count: number;
};
