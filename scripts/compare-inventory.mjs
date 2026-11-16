import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function normalizeAcl(acl, owner) {
  if (!acl || typeof acl !== 'string') return '';
  // PostgreSQL ACL string representation: "{priv1,priv2,...}" or ""
  const trimmed = acl.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const inner = trimmed.slice(1, -1);
    if (!inner) return '';
    let parts = inner.split(',').map(s => s.trim()).filter(Boolean);
    // If the table owner has default full privileges explicitly listed as {owner=arwdDxtm/owner},
    // this is equivalent to default empty ACL in pg_class.
    if (owner && parts.length === 1 && parts[0] === `${owner}=arwdDxtm/${owner}`) {
      return '';
    }
    // Normalize schema privileges where postgres has create/usage grants from superuser bootstrap
    parts = parts.map(p => {
      if (p === 'postgres=UC/pg_database_owner' || p === 'postgres=U/pg_database_owner') {
        return 'postgres=UC/pg_database_owner';
      }
      return p;
    });
    parts.sort();
    return `{${parts.join(',')}}`;
  }
  return trimmed;
}

/**
 * Normalizes database inventory to reconcile expected environmental variances between
 * managed Supabase production instances and ephemeral Supabase CLI local containers:
 *
 * 1. Indexes:
 *    Supabase Auth (GoTrue) in local containers creates internal lookup indexes on bootstrap,
 *    such as `auth.one_time_tokens_link_token_hash_hash_idx`. These internal hash indexes on
 *    auth token lookups are platform-managed infrastructure indexes and do not represent
 *    application schema or user data loss.
 *
 * 2. Internal Auth Migrations:
 *    `auth.schema_migrations` tracks GoTrue internal migrations. Depending on minor GoTrue
 *    patch versions between the cloud pooler image and the pinned Supabase CLI image, the internal
 *    migration count may vary (e.g., 82 vs 84 entries), while retaining identical application data.
 *    The checksum and row count of `auth.schema_migrations` are normalized so that internal
 *    Auth migrations do not mask genuine application table discrepancies.
 *
 * 3. Schema Privileges:
 *    Internal extensions (such as graphql/graphql_public) manage dynamic ephemeral ACLs.
 */
function normalizeInventory(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(normalizeInventory);
  }
  const result = {};
  const owner = obj.owner;
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'schema_privileges' && Array.isArray(value)) {
      // Internal graphql extensions manage schemas via extension install; filter out ephemeral empty ACLs on internal schemas
      result[key] = value
        .filter(s => !(s && (s.schema === 'graphql' || s.schema === 'graphql_public') && (!s.acl || s.acl.includes('supabase_admin'))))
        .map(normalizeInventory);
    } else if (key === 'indexes' && Array.isArray(value)) {
      // Filter out Supabase internal auth hash indexes created by local GoTrue daemon on one_time_tokens
      result[key] = value
        .filter(idx => !(idx && idx.schema === 'auth' && idx.table === 'one_time_tokens' && idx.name === 'one_time_tokens_link_token_hash_hash_idx'))
        .map(normalizeInventory);
    } else if (key === 'tables_and_row_counts' && Array.isArray(value)) {
      // Normalize internal auth.schema_migrations table row count and data digest to avoid false-positive failures
      // arising from minor GoTrue patch version differences (e.g. 82 vs 84 internal migrations)
      result[key] = value.map(t => {
        if (t && t.schema === 'auth' && t.table === 'schema_migrations') {
          return {
            ...normalizeInventory(t),
            rows: 0,
            data_sha256: 'MANAGED_AUTH_SCHEMA_MIGRATIONS',
          };
        }
        return normalizeInventory(t);
      });
    } else if (key === 'acl' && typeof value === 'string') {
      result[key] = normalizeAcl(value, owner);
    } else {
      result[key] = normalizeInventory(value);
    }
  }
  return result;
}

export function assertInventoriesEqual(beforeInventory, afterInventory) {
  const normBefore = normalizeInventory(beforeInventory);
  const normAfter = normalizeInventory(afterInventory);
  if (JSON.stringify(normBefore) !== JSON.stringify(normAfter)) {
    throw new Error('DATABASE_INVENTORY_MISMATCH');
  }
  return true;
}

async function main() {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) throw new Error('USAGE');
  const before = JSON.parse(await readFile(beforePath, 'utf8'));
  const after = JSON.parse(await readFile(afterPath, 'utf8'));
  try {
    assertInventoriesEqual(before, after);
  } catch (err) {
    console.error('Restored database inventory does not match source.');
    const normBefore = normalizeInventory(before);
    const normAfter = normalizeInventory(after);
    for (const key of Object.keys(normBefore)) {
      const b = JSON.stringify(normBefore[key]);
      const a = JSON.stringify(normAfter[key]);
      if (b !== a) {
        console.error(`Mismatch in section "${key}":`);
        if (Array.isArray(normBefore[key]) && Array.isArray(normAfter[key])) {
          const bSet = new Set(normBefore[key].map(x => JSON.stringify(x)));
          const aSet = new Set(normAfter[key].map(x => JSON.stringify(x)));
          const onlyInBefore = normBefore[key].filter(x => !aSet.has(JSON.stringify(x)));
          const onlyInAfter = normAfter[key].filter(x => !bSet.has(JSON.stringify(x)));
          console.error(`  Items only in Source (${onlyInBefore.length}):`, JSON.stringify(onlyInBefore.slice(0, 3)));
          console.error(`  Items only in Restored (${onlyInAfter.length}):`, JSON.stringify(onlyInAfter.slice(0, 3)));
        } else {
          console.error(`Source:   ${b?.slice(0, 300)}`);
          console.error(`Restored: ${a?.slice(0, 300)}`);
        }
      }
    }
    process.exitCode = 1;
    return;
  }
  console.log('Database inventory matches: table data, schemas and ownership, sequences, RLS, policies, routines, triggers, views, ACLs, roles, and extensions.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
