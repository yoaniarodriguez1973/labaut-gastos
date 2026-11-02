// =====================================================================
//  Supabase Edge Function "notify": envía notificaciones push a la familia.
//  La app la llama después de guardar un gasto común, un aporte,
//  marcar un gasto como "No imputa" o cerrar el mes.
//
//  Secretos necesarios (Edge Functions → Secrets):
//    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:tu-email)
//  Configuración: desactivar "Verify JWT" (el usuario se verifica en el código).
// =====================================================================
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:yoania.rodriguez1973@gmail.com';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const fmt = new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU', maximumFractionDigits: 0 });
const money = (v: unknown) => fmt.format(Number(v) || 0);
const KIND: Record<string, string> = { cuota: 'Cuota mensual', ajuste: 'Ajuste fin de mes', inicial: 'Saldo inicial / ingreso' };
const isRecent = (t: string) => Date.now() - new Date(t).getTime() < 15 * 60 * 1000; // evita avisos repetidos de cosas viejas
const monthName = (id: string) => {
  const [y, m] = id.split('-').map(Number);
  const s = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-UY', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

type Msg = { title: string; body: string; url: string; tag: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    // 1) ¿Quién llama? (debe ser un miembro de la familia con sesión iniciada)
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return json({ error: 'No autorizado' }, 401);
    const { data: me } = await admin.from('members').select('id, name, is_admin').eq('id', user.id).maybeSingle();
    if (!me) return json({ error: 'No es miembro de la familia' }, 403);

    const { type, id, balance } = await req.json();

    // La app pide la clave pública para suscribirse
    if (type === 'key') return json({ publicKey: VAPID_PUBLIC_KEY });
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json({ error: 'Faltan las claves VAPID en Secrets' }, 500);

    const { data: members } = await admin.from('members').select('id, name');
    const nameOf = (mid: string) => members?.find((m) => m.id === mid)?.name ?? 'Alguien';
    const others = (members ?? []).map((m) => m.id).filter((mid) => mid !== me.id);

    // 2) Armar el mensaje según el tipo
    let to: string[] = [];
    let msg: Msg;

    if (type === 'expense') {
      const { data: e } = await admin.from('expenses').select('*').eq('id', id).maybeSingle();
      if (!e || e.created_by !== me.id || e.scope !== 'comun' || !isRecent(e.created_at)) return json({ skipped: true });
      to = others;
      msg = {
        title: '🛒 Nuevo gasto común',
        body: `${me.name}: ${money(e.shared_uyu)} en ${e.category}${e.note ? ' · ' + e.note : ''}`,
        url: './#/movimientos',
        tag: 'exp-' + e.id,
      };
    } else if (type === 'contribution') {
      const { data: c } = await admin.from('contributions').select('*').eq('id', id).maybeSingle();
      if (!c || c.created_by !== me.id || !isRecent(c.created_at)) return json({ skipped: true });
      to = others;
      msg = {
        title: '💵 Nuevo aporte a la caja',
        body: `${nameOf(c.member_id)} aportó ${money(c.amount)} · ${KIND[c.kind] ?? c.kind}`,
        url: './#/balance',
        tag: 'con-' + c.id,
      };
    } else if (type === 'excluded') {
      if (!me.is_admin) return json({ error: 'Solo la administradora' }, 403);
      const { data: e } = await admin.from('expenses').select('*').eq('id', id).maybeSingle();
      if (!e || !e.excluded || e.created_by === me.id) return json({ skipped: true });
      to = [e.created_by];
      msg = {
        title: '🚫 Gasto marcado como "No imputa"',
        body: `${money(e.amount_uyu)} en ${e.category}${e.note ? ' (' + e.note + ')' : ''}` +
              `${e.excluded_reason ? ' — ' + e.excluded_reason : ''}. Pasa a tus gastos personales.`,
        url: './#/movimientos?vista=mios',
        tag: 'exc-' + e.id,
      };
    } else if (type === 'closed') {
      if (!me.is_admin) return json({ error: 'Solo la administradora' }, 403);
      const { data: mo } = await admin.from('months').select('*').eq('id', id).maybeSingle();
      if (!mo || !mo.closed) return json({ skipped: true });
      to = others;
      const b = Number(balance);
      const extra = Number.isFinite(b)
        ? (b >= 0 ? ` Sobran ${money(b)} que pasan al mes siguiente.` : ` Quedó un faltante de ${money(-b)}.`)
        : '';
      msg = { title: '🔒 Mes cerrado', body: `${monthName(mo.id)} se cerró.${extra}`, url: './#/balance', tag: 'mes-' + mo.id };
    } else {
      return json({ error: 'Tipo desconocido' }, 400);
    }

    if (!to.length) return json({ sent: 0 });

    // 3) Enviar a todos los celulares suscritos de los destinatarios
    const { data: subs } = await admin.from('push_subscriptions').select('*').in('member_id', to);
    const payload = JSON.stringify(msg);
    let sent = 0;
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        // 404/410 = el celular ya no existe o desactivó los avisos: se borra
        if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        else console.error('Error enviando push', code, err);
      }
    }));
    return json({ sent });
  } catch (err) {
    console.error(err);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
});
