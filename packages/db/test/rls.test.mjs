/**
 * Gate G0. Este teste nao verifica que a RLS "esta ligada" — ele tenta,
 * de verdade, ler e escrever dados de outro tenant e exige que falhe.
 *
 * Requer um Postgres com as migracoes aplicadas:
 *   TEST_DATABASE_URL=postgres://... node packages/db/scripts/migrate.mjs
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const admin = new pg.Client({ connectionString: url });

// Papel de aplicacao: sujeito a RLS. O owner do banco a ignoraria.
const APP_ROLE = "olga_app";
let appDb;
const ids = {};

async function asUser(userId, fn) {
  try { await appDb.query("rollback"); } catch {}
  await appDb.query("begin");
  await appDb.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: userId, role: "authenticated" })]);
  try { return await fn(); } finally { await appDb.query("rollback"); }
}

async function cleanFixtures(c) {
  await c.query(`delete from mkt.organizations where slug in ('corretora-a','corretora-b')`);
  await c.query(`delete from mkt.app_users where email in ('ana@corretora-a.com.br','bruno@corretora-b.com.br')`);
}

before(async () => {
  await admin.connect();
  // Idempotente: uma execucao interrompida nao pode envenenar a proxima.
  await cleanFixtures(admin);

  await admin.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = '${APP_ROLE}') then
        create role ${APP_ROLE} login password 'olga_app_pw';
      end if;
    end $$;`);
  await admin.query(`grant usage on schema mkt to ${APP_ROLE}`);
  await admin.query(`grant select, insert, update, delete on all tables in schema mkt to ${APP_ROLE}`);
  await admin.query(`grant usage, select on all sequences in schema mkt to ${APP_ROLE}`);
  await admin.query(`grant execute on all functions in schema mkt to ${APP_ROLE}`);

  // Dois tenants completos, criados como admin (fora da RLS).
  const r = await admin.query(`
    with u as (
      insert into mkt.app_users (email, full_name) values
        ('ana@corretora-a.com.br','Ana A'), ('bruno@corretora-b.com.br','Bruno B')
      returning id, email
    ), o as (
      insert into mkt.organizations (name, slug) values
        ('Corretora A','corretora-a'), ('Corretora B','corretora-b')
      returning id, slug
    )
    select
      (select id from u where email like 'ana%')   as user_a,
      (select id from u where email like 'bruno%') as user_b,
      (select id from o where slug = 'corretora-a') as org_a,
      (select id from o where slug = 'corretora-b') as org_b`);
  Object.assign(ids, r.rows[0]);

  for (const [org, user] of [[ids.org_a, ids.user_a], [ids.org_b, ids.user_b]]) {
    await admin.query(`insert into mkt.memberships (org_id, user_id, role) values ($1,$2,'OWNER')`, [org, user]);
  }
  const ws = await admin.query(`
    insert into mkt.workspaces (org_id, name) values ($1,'Principal'),($2,'Principal')
    returning id, org_id`, [ids.org_a, ids.org_b]);
  ids.ws_a = ws.rows.find((x) => x.org_id === ids.org_a).id;
  ids.ws_b = ws.rows.find((x) => x.org_id === ids.org_b).id;

  const br = await admin.query(`
    insert into mkt.brands (org_id, workspace_id, name) values ($1,$2,'Marca A'),($3,$4,'Marca B')
    returning id, org_id`, [ids.org_a, ids.ws_a, ids.org_b, ids.ws_b]);
  ids.brand_a = br.rows.find((x) => x.org_id === ids.org_a).id;
  ids.brand_b = br.rows.find((x) => x.org_id === ids.org_b).id;

  // Importante: montar a conexao por partes. Se passassemos connectionString,
  // o usuario embutido nela venceria e o teste rodaria como superusuario —
  // que ignora RLS e tornaria todo este arquivo inutil.
  const u = new URL(url);
  appDb = new pg.Client({
    host: u.hostname,
    port: Number(u.port || 5432),
    database: u.pathname.slice(1),
    user: APP_ROLE,
    password: "olga_app_pw",
    ssl: u.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : undefined,
  });
  await appDb.connect();
});

after(async () => {
  if (appDb) { try { await appDb.query("rollback"); } catch {} await appDb.end(); }
  await cleanFixtures(admin);
  await admin.end();
});

test("o papel de aplicacao esta mesmo sujeito a RLS", async () => {
  const r = await appDb.query(`select current_user as u, (select rolbypassrls from pg_roles where rolname = current_user) as bypass`);
  assert.equal(r.rows[0].u, APP_ROLE);
  assert.equal(r.rows[0].bypass, false, "o teste seria inutil com um papel que ignora RLS");
});

test("sem identidade, nenhuma linha e visivel", async () => {
  const r = await appDb.query("select count(*)::int as n from mkt.brands");
  assert.equal(r.rows[0].n, 0);
});

test("Ana ve apenas a marca da Corretora A", async () => {
  await asUser(ids.user_a, async () => {
    const r = await appDb.query("select id, name from mkt.brands");
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].name, "Marca A");
  });
});

test("Bruno ve apenas a marca da Corretora B", async () => {
  await asUser(ids.user_b, async () => {
    const r = await appDb.query("select name from mkt.brands");
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].name, "Marca B");
  });
});

test("Ana nao alcanca a marca de Bruno nem pedindo pelo id", async () => {
  await asUser(ids.user_a, async () => {
    const r = await appDb.query("select * from mkt.brands where id = $1", [ids.brand_b]);
    assert.equal(r.rows.length, 0, "vazamento cross-tenant na leitura");
  });
});

test("Ana nao consegue escrever na org de Bruno", async () => {
  await asUser(ids.user_a, async () => {
    await assert.rejects(
      () => appDb.query(`insert into mkt.brands (org_id, workspace_id, name) values ($1,$2,'Invasora')`,
        [ids.org_b, ids.ws_b]),
      (e) => e.code === "42501",
      "insert cross-tenant deveria violar a policy",
    );
  });
});

test("Ana nao consegue alterar linha de Bruno", async () => {
  await asUser(ids.user_a, async () => {
    const r = await appDb.query(`update mkt.brands set name = 'sequestrada' where id = $1`, [ids.brand_b]);
    assert.equal(r.rowCount, 0, "update cross-tenant afetou linhas");
  });
});

test("Ana nao consegue apagar linha de Bruno", async () => {
  await asUser(ids.user_a, async () => {
    const r = await appDb.query(`delete from mkt.brands where id = $1`, [ids.brand_b]);
    assert.equal(r.rowCount, 0, "delete cross-tenant afetou linhas");
  });
});

test("workspaces, conteudo e receipts respeitam o mesmo escopo", async () => {
  await asUser(ids.user_a, async () => {
    for (const t of ["workspaces", "contents", "action_receipts", "audit_events", "agent_runs"]) {
      const r = await appDb.query(`select count(*)::int as n from mkt.${t} where org_id = $1`, [ids.org_b]);
      assert.equal(r.rows[0].n, 0, `${t} vazou entre tenants`);
    }
  });
});

test("um usuario sem membership nao ve nada", async () => {
  await asUser("00000000-0000-0000-0000-000000000000", async () => {
    const r = await appDb.query("select count(*)::int as n from mkt.brands");
    assert.equal(r.rows[0].n, 0);
  });
});

test("toda tabela tenant-owned tem RLS ligada e forcada", async () => {
  const r = await admin.query(`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'mkt' and c.relkind = 'r'
      and exists (select 1 from information_schema.columns col
                  where col.table_schema='mkt' and col.table_name=c.relname and col.column_name='org_id')`);
  assert.ok(r.rows.length >= 10, `esperava dezenas de tabelas tenant-owned, achei ${r.rows.length}`);
  for (const t of r.rows) {
    assert.equal(t.relrowsecurity, true, `${t.relname} sem RLS`);
    assert.equal(t.relforcerowsecurity, true, `${t.relname} sem FORCE RLS (o dono da tabela escaparia)`);
  }
});

test("a state machine do conteudo bloqueia DRAFT -> PUBLISHED no banco", async () => {
  const cv = await admin.query(`
    with c as (
      insert into mkt.contents (org_id, workspace_id, brand_id, title)
      values ($1,$2,$3,'Teste de transicao') returning id
    )
    insert into mkt.content_versions (org_id, content_id, version, master_body)
    select $1, c.id, 1, 'corpo' from c returning id`, [ids.org_a, ids.ws_a, ids.brand_a]);
  const id = cv.rows[0].id;
  await assert.rejects(
    () => admin.query(`update mkt.content_versions set state='PUBLISHED' where id=$1`, [id]),
    /INVALID_STATE_TRANSITION/,
  );
  await admin.query(`update mkt.content_versions set state='AI_REVIEW' where id=$1`, [id]);
  await admin.query(`update mkt.content_versions set state='APPROVED' where id=$1`, [id]);
  const ok = await admin.query(`select state, approved_at from mkt.content_versions where id=$1`, [id]);
  assert.equal(ok.rows[0].state, "APPROVED");
  assert.ok(ok.rows[0].approved_at, "approved_at deveria ter sido carimbado");
});

test("editar o corpo depois de aprovado derruba a aprovacao", async () => {
  const cv = await admin.query(`
    with c as (
      insert into mkt.contents (org_id, workspace_id, brand_id, title)
      values ($1,$2,$3,'Teste de edicao') returning id
    )
    insert into mkt.content_versions (org_id, content_id, version, master_body, state)
    select $1, c.id, 1, 'original', 'DRAFT' from c returning id`, [ids.org_a, ids.ws_a, ids.brand_a]);
  const id = cv.rows[0].id;
  await admin.query(`update mkt.content_versions set state='AI_REVIEW' where id=$1`, [id]);
  await admin.query(`update mkt.content_versions set state='APPROVED' where id=$1`, [id]);
  await admin.query(`update mkt.content_versions set master_body='texto trocado' where id=$1`, [id]);
  const r = await admin.query(`select state, approved_at from mkt.content_versions where id=$1`, [id]);
  assert.equal(r.rows[0].state, "DRAFT", "aprovacao deveria ter sido invalidada");
  assert.equal(r.rows[0].approved_at, null);
});

test("claim material sem evidence e rejeitado pela constraint", async () => {
  const cv = await admin.query(`
    with c as (
      insert into mkt.contents (org_id, workspace_id, brand_id, title)
      values ($1,$2,$3,'Teste de claim') returning id
    )
    insert into mkt.content_versions (org_id, content_id, version, master_body)
    select $1, c.id, 1, 'corpo' from c returning id`, [ids.org_a, ids.ws_a, ids.brand_a]);
  await assert.rejects(
    () => admin.query(`insert into mkt.claims (org_id, content_version_id, text, material, claim_type)
                       values ($1,$2,'Cobre 100% dos casos', true, 'COVERAGE')`, [ids.org_a, cv.rows[0].id]),
    /claim_material_requires_evidence/,
  );
});

test("capability de efeito externo sem idempotencia e rejeitada pela constraint", async () => {
  await assert.rejects(
    () => admin.query(`
      insert into mkt.capability_registry
        (capability_id, version, status, mode, side_effect, risk_tier, input_schema_ref, output_schema_ref, permissions)
      values ('teste.externo_sem_idem', 1, 'CANDIDATE', 'write', 'external', 'LOW',
              'olga://io/capability-request','olga://io/execution-result','{OWNER}')`),
    /external_requires_idempotency/,
  );
});

test("a mesma idempotency_key nao produz dois efeitos", async () => {
  const key = `ws:${ids.ws_a}:cv:teste:INSTAGRAM:conn1`;
  await admin.query(`
    insert into mkt.action_receipts
      (org_id, workspace_id, capability_id, capability_version, idempotency_key, status, autonomy_used, trace_id)
    values ($1,$2,'publishing.publish',1,$3,'EFFECTED','A3','tr_1')`, [ids.org_a, ids.ws_a, key]);
  await assert.rejects(
    () => admin.query(`
      insert into mkt.action_receipts
        (org_id, workspace_id, capability_id, capability_version, idempotency_key, status, autonomy_used, trace_id)
      values ($1,$2,'publishing.publish',1,$3,'EFFECTED','A3','tr_2')`, [ids.org_a, ids.ws_a, key]),
    /duplicate key|unique/i,
  );
});

test("auditoria e append-only para a aplicacao: nem edita nem apaga o passado", async () => {
  await admin.query(`
    insert into mkt.audit_events (org_id, actor_type, actor_id, action, object_type, trace_id)
    values ($1,'user','ana','content.approved','content_version','tr_audit')`, [ids.org_a]);

  await asUser(ids.user_a, async () => {
    const visivel = await appDb.query(`select action from mkt.audit_events where trace_id='tr_audit'`);
    assert.equal(visivel.rows.length, 1, "o dono do evento deveria conseguir ler");

    const upd = await appDb.query(`update mkt.audit_events set action='mentira' where trace_id='tr_audit'`);
    assert.equal(upd.rowCount, 0, "auditoria nao pode ser reescrita");

    const del = await appDb.query(`delete from mkt.audit_events where trace_id='tr_audit'`);
    assert.equal(del.rowCount, 0, "auditoria nao pode ser apagada");
  });

  const r = await admin.query(`select action from mkt.audit_events where trace_id='tr_audit'`);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].action, "content.approved");
});

test("receipt emitido nao pode ser reescrito pela aplicacao", async () => {
  const key = `ws:${ids.ws_a}:receipt-imutavel`;
  await admin.query(`
    insert into mkt.action_receipts
      (org_id, workspace_id, capability_id, capability_version, idempotency_key, status, autonomy_used, trace_id)
    values ($1,$2,'publishing.publish',1,$3,'EFFECTED','A3','tr_imut')`, [ids.org_a, ids.ws_a, key]);
  await asUser(ids.user_a, async () => {
    const upd = await appDb.query(`update mkt.action_receipts set status='FAILED' where idempotency_key=$1`, [key]);
    assert.equal(upd.rowCount, 0, "receipt nao pode mudar de status depois de emitido");
    const del = await appDb.query(`delete from mkt.action_receipts where idempotency_key=$1`, [key]);
    assert.equal(del.rowCount, 0, "receipt nao pode ser apagado");
  });
});

// ---------------------------------------------------------------------
// Invariante estrutural, nao caso particular.
//
// mkt.processed_events nasceu sem RLS porque nao tem org_id e por isso nao
// passou pelo helper mkt.enable_org_rls(). O advisor do Supabase encontrou
// depois de o schema ja estar aplicado em banco: no Supabase, tabela sem RLS
// e tabela publica para quem tem a anon key.
//
// A correcao pontual esta em 0005 e 0008. Este teste e o que impede a
// repeticao: qualquer tabela nova que entre no schema sem RLS quebra o Gate G0,
// tenha ela org_id ou nao.
// ---------------------------------------------------------------------
test("nenhuma tabela do schema fica sem RLS", async () => {
  const { rows } = await admin.query(`
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'mkt'
       and c.relkind = 'r'
       and c.relrowsecurity = false
     order by c.relname`);
  assert.deepEqual(
    rows.map((r) => r.relname), [],
    "toda tabela em mkt precisa de RLS ligada — sem org_id nao e desculpa, " +
    "ligue sem policy para deixar so service_role passar",
  );
});

// Ligar RLS sem policy nao adianta se a tabela nao negar de fato.
test("processed_events nega leitura e escrita para o papel da aplicacao", async () => {
  await admin.query(
    `insert into mkt.processed_events (consumer, event_key) values ('worker','ev-rls-check')
     on conflict do nothing`);

  await asUser(ids.user_a, async () => {
    const sel = await appDb.query(`select * from mkt.processed_events where event_key = 'ev-rls-check'`);
    assert.equal(sel.rows.length, 0, "anon/authenticated nao pode ler o ledger de dedup");

    await assert.rejects(
      () => appDb.query(`insert into mkt.processed_events (consumer, event_key) values ('x','y')`),
      /row-level security/i,
      "anon/authenticated nao pode escrever no ledger de dedup",
    );
  });

  await admin.query(`delete from mkt.processed_events where event_key = 'ev-rls-check'`);
});
