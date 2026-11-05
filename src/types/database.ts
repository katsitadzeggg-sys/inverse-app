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
  /** Set when an owner/admin removed this person: no access, name kept on past work. */
  disabled_at: string | null;
  /** Modules this person may count in. */
  modules: ('stock' | 'expiry' | 'assets')[];
  created_at: string;
  updated_at: string;
};

export type CompanyInvite = {
  id: string;
  company_id: string;
  email: string;
  role: UserRole;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
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

export type StocktakeStatus = 'open' | 'closed';
export type ZoneStatus = 'counting' | 'done';

export type Stocktake = {
  id: string;
  company_id: string;
  number: string;
  count_date: string;
  client_name: string | null;
  branch: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  name: string;
  status: StocktakeStatus;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
  kind: 'stock' | 'expiry' | 'assets';
};

export type StocktakeZone = {
  id: string;
  company_id: string;
  stocktake_id: string;
  location_id: string;
  counter_id: string | null;
  status: ZoneStatus;
  started_at: string;
  done_at: string | null;
  note: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  located_at: string | null;
};

export type StocktakeEntry = {
  id: string;
  company_id: string;
  stocktake_id: string;
  location_id: string;
  product_id: string | null;
  unknown_label: string | null;
  quantity: number;
  boxes: number | null;
  per_box: number | null;
  counter_id: string | null;
  photo_path: string | null;
  recounted: boolean;
  created_at: string;
  updated_at: string;
  expiry_date: string | null;
};

export type StocktakeCheckStatus = 'ok' | 'recount' | 'frozen';
