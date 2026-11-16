// Local read-only test of supabase/functions/market-valuation/wb-form.ts under Deno.
// deno run --allow-net deno-test.ts '<json input>'
import { marketValue } from '../../supabase/functions/market-valuation/wb-form.ts';
const t0 = Date.now();
try { console.log(JSON.stringify({ ...(await marketValue(JSON.parse(Deno.args[0]))), ms: Date.now() - t0 })); }
catch (e) { console.log(JSON.stringify({ error: String((e as Error).message || e), ms: Date.now() - t0 })); }
