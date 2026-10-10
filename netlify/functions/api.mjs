import { getStore } from "@netlify/blobs";

export const config = { path: "/api/*" };

const enc = new TextEncoder();
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const db = () => getStore({ name: "crm", consistency: "strong" });
const out = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (m, s = 400) => out({ error: m }, s);

// ---------- contraseñas y tokens ----------
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: ub64(salt), iterations: 100000 }, k, 256));
}
async function mkPw(pw) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await hashPw(pw, salt) };
}
const okPw = async (pw, rec) => !!rec && (await hashPw(String(pw || ""), rec.salt)) === rec.hash;
async function hmacKey(s) {
  let sec = await s.get("secret");
  if (!sec) { sec = b64(crypto.getRandomValues(new Uint8Array(32))); await s.set("secret", sec); }
  return crypto.subtle.importKey("raw", enc.encode(sec), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function sign(s, p) {
  const body = btoa(JSON.stringify(p));
  return body + "." + b64(await crypto.subtle.sign("HMAC", await hmacKey(s), enc.encode(body)));
}
async function verify(s, t) {
  const [body, sig] = String(t || "").split(".");
  if (!body || !sig) return null;
  const good = b64(await crypto.subtle.sign("HMAC", await hmacKey(s), enc.encode(body)));
  if (good !== sig) return null;
  try { const p = JSON.parse(atob(body)); return p.exp > Date.now() ? p : null; } catch { return null; }
}

// ---------- utilidades ----------
const str = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const JOB_F = ["cliente","telefono","email","direccion","localidad","referencia","marca","tipo","cantidad","monto","detalle","fecha","franja","instaladorId","estado","notas"];
const ESTADOS = ["pendiente", "en_camino", "en_curso", "instalado", "cancelado"];
const pubInst = ({ pw, ...r }) => r;
const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "") && !isNaN(Date.parse(d));
const todayAR = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const addYear = (d) => {
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y + 1, m - 1, dd));
  if (t.getUTCMonth() !== m - 1) t.setUTCDate(0);
  return t.toISOString().slice(0, 10);
};
const M_F = ["cliente","telefono","localidad","direccion","referencia","marca","tipo","cantidad","detalle","fechaInstalacion","proximoMantenimiento","fechaVisita","instaladorId","notas"];
// Cada instalación terminada genera un mantenimiento programado a 1 año
async function ensureMaint(s, j) {
  const key = "mant/job_" + j.id;
  if (await s.get(key, { type: "json" })) return;
  const fi = j.fechaInstalado || j.fecha || todayAR();
  await s.setJSON(key, { id: "job_" + j.id, jobId: j.id, cliente: j.cliente, telefono: j.telefono, direccion: j.direccion, localidad: j.localidad || "", referencia: j.referencia || "", marca: j.marca || "", tipo: j.tipo || "", cantidad: j.cantidad || "", detalle: j.detalle || "", fechaInstalacion: fi, proximoMantenimiento: addYear(fi), fechaVisita: "", instaladorId: j.instaladorId || "", activo: true, historial: [], notas: "", creado: Date.now(), actualizado: Date.now() });
}
async function list(s, prefix) {
  const { blobs } = await s.list({ prefix });
  return (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean);
}
const userTaken = async (s, user, exceptId) => {
  const u = user.toLowerCase();
  const adm = await s.get("admin", { type: "json" });
  if (adm && adm.user.toLowerCase() === u) return true;
  return (await list(s, "inst/")).some((i) => i.id !== exceptId && i.user.toLowerCase() === u);
};

export default async (req) => {
  const s = db();
  const parts = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [r, id, sub] = parts, m = req.method;
  let body = {};
  if (m !== "GET" && m !== "DELETE") { try { body = await req.json(); } catch { return fail("Datos inválidos"); } }

  // ----- rutas públicas -----
  if (r === "status" && m === "GET") {
    const adm = await s.get("admin", { type: "json" });
    const cfg = (await s.get("config", { type: "json" })) || {};
    return out({ setup: !!adm, negocio: cfg.negocio || "LV Seguridad Moreno" });
  }
  if (r === "setup" && m === "POST") {
    if (await s.get("admin", { type: "json" })) return fail("Ya está configurado", 403);
    const user = str(body.user, 40), pw = String(body.password || "");
    if (user.length < 3 || pw.length < 6) return fail("Usuario (mín. 3) y contraseña (mín. 6)");
    await s.setJSON("admin", { user, pw: await mkPw(pw) });
    await s.setJSON("config", { negocio: str(body.negocio, 80) || "LV Seguridad Moreno", telefono: "", email: "" });
    return out({ ok: true });
  }
  if (r === "login" && m === "POST") {
    const user = str(body.user, 40).toLowerCase(), pw = body.password;
    const adm = await s.get("admin", { type: "json" });
    if (adm && adm.user.toLowerCase() === user && (await okPw(pw, adm.pw)))
      return out({ token: await sign(s, { role: "admin", id: "admin", exp: Date.now() + 30 * 864e5 }), role: "admin" });
    const ins = (await list(s, "inst/")).find((i) => i.user.toLowerCase() === user);
    if (ins && ins.activo !== false && (await okPw(pw, ins.pw)))
      return out({ token: await sign(s, { role: "inst", id: ins.id, exp: Date.now() + 30 * 864e5 }), role: "inst" });
    return fail("Usuario o contraseña incorrectos", 401);
  }

  // ----- rutas autenticadas -----
  const au = await verify(s, (req.headers.get("authorization") || "").replace(/^Bearer /, ""));
  if (!au) return fail("Sesión vencida", 401);
  const admin = au.role === "admin";
  const cfg = (await s.get("config", { type: "json" })) || {};

  if (r === "data" && m === "GET") {
    if (admin) {
      const a = await s.get("admin", { type: "json" });
      return out({ role: "admin", cfg, adminUser: a.user, installers: (await list(s, "inst/")).map(pubInst), jobs: await list(s, "job/"), maint: await list(s, "mant/") });
    }
    const me = await s.get("inst/" + au.id, { type: "json" });
    if (!me || me.activo === false) return fail("Cuenta desactivada", 401);
    return out({ role: "inst", cfg, me: pubInst(me), jobs: (await list(s, "job/")).filter((j) => j.instaladorId === au.id), maint: (await list(s, "mant/")).filter((x) => x.instaladorId === au.id && x.activo !== false) });
  }

  if (r === "me" && m === "PUT" && !admin) {
    const me = await s.get("inst/" + au.id, { type: "json" });
    if (!me) return fail("No existe", 404);
    me.nombre = str(body.nombre, 80) || me.nombre;
    me.telefono = str(body.telefono, 40);
    if (body.password) {
      if (String(body.password).length < 6) return fail("La contraseña nueva necesita 6 caracteres o más");
      if (!(await okPw(body.currentPassword, me.pw))) return fail("La contraseña actual no coincide", 403);
      me.pw = await mkPw(String(body.password));
    }
    await s.setJSON("inst/" + au.id, me);
    return out({ ok: true });
  }

  if (r === "jobs" && m === "PATCH" && !admin && id) {
    const j = await s.get("job/" + id, { type: "json" });
    if (!j || j.instaladorId !== au.id) return fail("Trabajo no encontrado", 404);
    if (body.estado !== undefined) {
      if (!ESTADOS.includes(body.estado) || body.estado === "cancelado") return fail("Estado inválido");
      j.estado = body.estado;
      if (j.estado === "instalado" && !j.fechaInstalado) j.fechaInstalado = todayAR();
    }
    if (body.notaInst !== undefined) j.notaInst = str(body.notaInst, 2000);
    j.actualizado = Date.now();
    await s.setJSON("job/" + id, j);
    if (j.estado === "instalado") await ensureMaint(s, j);
    return out({ ok: true });
  }

  // registrar un mantenimiento realizado (administrador o instalador asignado)
  if (r === "maintenances" && id && sub === "visit" && m === "POST") {
    const mt = await s.get("mant/" + id, { type: "json" });
    if (!mt) return fail("No existe", 404);
    if (!admin && mt.instaladorId !== au.id) return fail("Sin permiso", 403);
    const fecha = okDate(body.fecha) ? body.fecha : todayAR();
    let por = "Administrador";
    if (admin) { const a = await s.get("admin", { type: "json" }); if (a) por = a.user; }
    else { const me = await s.get("inst/" + au.id, { type: "json" }); por = me ? me.nombre : "Instalador"; }
    mt.historial = [...(mt.historial || []), { fecha, nota: str(body.nota, 1000), por }];
    mt.ultimoMantenimiento = fecha; mt.proximoMantenimiento = addYear(fecha); mt.fechaVisita = ""; mt.actualizado = Date.now();
    await s.setJSON("mant/" + id, mt);
    return out({ ok: true, proximo: mt.proximoMantenimiento });
  }

  // ----- solo administrador -----
  if (!admin) return fail("Sin permiso", 403);

  if (r === "jobs") {
    if (m === "DELETE" && id) { await s.delete("job/" + id); return out({ ok: true }); }
    if ((m === "POST" && !id) || (m === "PUT" && id)) {
      const old = id ? await s.get("job/" + id, { type: "json" }) : null;
      if (id && !old) return fail("No existe", 404);
      const j = { ...(old || {}), id: id || crypto.randomUUID() };
      JOB_F.forEach((k) => (j[k] = str(body[k], k === "detalle" || k === "notas" ? 2000 : 200)));
      if (!j.cliente || !j.telefono || !j.direccion) return fail("Faltan cliente, teléfono o dirección");
      if (!ESTADOS.includes(j.estado)) j.estado = "pendiente";
      j.creado = j.creado || Date.now(); j.actualizado = Date.now();
      if (j.estado === "instalado" && !j.fechaInstalado) j.fechaInstalado = todayAR();
      await s.setJSON("job/" + j.id, j);
      if (j.estado === "instalado") await ensureMaint(s, j);
      return out({ ok: true, id: j.id });
    }
  }

  if (r === "maintenances") {
    if (m === "DELETE" && id) { await s.delete("mant/" + id); return out({ ok: true }); }
    if ((m === "POST" && !id) || (m === "PUT" && id)) {
      const old = id ? await s.get("mant/" + id, { type: "json" }) : null;
      if (id && !old) return fail("No existe", 404);
      const x = { historial: [], ...(old || {}), id: id || crypto.randomUUID() };
      M_F.forEach((k) => (x[k] = str(body[k], k === "detalle" || k === "notas" ? 2000 : 200)));
      x.activo = body.activo !== false;
      if (!x.cliente || !x.telefono || !x.direccion) return fail("Faltan cliente, teléfono o dirección");
      if (!okDate(x.fechaInstalacion)) return fail("Fecha de instalación inválida");
      if (!okDate(x.proximoMantenimiento)) x.proximoMantenimiento = addYear(x.fechaInstalacion);
      if (!okDate(x.fechaVisita)) x.fechaVisita = "";
      x.creado = x.creado || Date.now(); x.actualizado = Date.now();
      await s.setJSON("mant/" + x.id, x);
      return out({ ok: true, id: x.id });
    }
  }

  if (r === "config" && m === "PUT") {
    await s.setJSON("config", { negocio: str(body.negocio, 80) || "LV Seguridad Moreno", telefono: str(body.telefono, 40), email: str(body.email, 80) });
    return out({ ok: true });
  }

  if (r === "admin" && m === "PUT") {
    const a = await s.get("admin", { type: "json" });
    if (!(await okPw(body.currentPassword, a.pw))) return fail("La contraseña actual no coincide", 403);
    const user = str(body.user, 40) || a.user;
    if (user.length < 3) return fail("Usuario demasiado corto");
    if (user.toLowerCase() !== a.user.toLowerCase() && (await userTaken(s, user))) return fail("Ese usuario ya existe");
    a.user = user;
    if (body.password) {
      if (String(body.password).length < 6) return fail("La contraseña nueva necesita 6 caracteres o más");
      a.pw = await mkPw(String(body.password));
    }
    await s.setJSON("admin", a);
    return out({ ok: true });
  }

  if (r === "installers") {
    if (m === "DELETE" && id) {
      await s.delete("inst/" + id);
      for (const j of (await list(s, "job/")).filter((x) => x.instaladorId === id)) { j.instaladorId = ""; await s.setJSON("job/" + j.id, j); }
      for (const x of (await list(s, "mant/")).filter((x) => x.instaladorId === id)) { x.instaladorId = ""; await s.setJSON("mant/" + x.id, x); }
      return out({ ok: true });
    }
    if ((m === "POST" && !id) || (m === "PUT" && id)) {
      const old = id ? await s.get("inst/" + id, { type: "json" }) : null;
      if (id && !old) return fail("No existe", 404);
      const i = { ...(old || {}), id: id || crypto.randomUUID() };
      i.nombre = str(body.nombre, 80); i.user = str(body.user, 40);
      i.telefono = str(body.telefono, 40); i.zona = str(body.zona, 80); i.activo = body.activo !== false;
      if (!i.nombre || i.user.length < 3) return fail("Nombre y usuario (mín. 3) son obligatorios");
      if (await userTaken(s, i.user, i.id)) return fail("Ese usuario ya existe");
      if (body.password || !old) {
        if (String(body.password || "").length < 6) return fail("La contraseña necesita 6 caracteres o más");
        i.pw = await mkPw(String(body.password));
      }
      await s.setJSON("inst/" + i.id, i);
      return out({ ok: true, id: i.id });
    }
  }
  return fail("Ruta no encontrada", 404);
};
