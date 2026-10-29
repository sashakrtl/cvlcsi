import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const store = getStore({ name: "cvl-csi", region: "eu-central-1" });
const COOKIE = "cvl_admin";
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const defaults = {
  news: [{ id: "n1", title: "Bienvenue sur le site du CVL", text: "Retrouvez ici les nouvelles du Conseil de la vie lycéenne, les projets qui prennent vie et les prochains rendez-vous.", date: new Date().toISOString().slice(0, 10), label: "La vie du CVL" }],
  meetings: [],
  projects: [{ id: "p1", title: "Les projets de cette année", text: "Les idées et projets du CVL seront présentés ici au fil de leur avancement. Vous avez une envie pour le lycée ? Partagez-la avec nous.", status: "En préparation" }],
  members: [],
  contacts: [{ id: "contact-email", category: "E-mail général", value: "À renseigner", url: "" }, { id: "contact-instagram", category: "Instagram", value: "À renseigner", url: "" }],
  messages: []
};

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
const fail = (message, status = 400) => json({ error: message }, status);

async function readContent() {
  const raw = await store.get("content", { type: "text", consistency: "strong" });
  if (!raw) return structuredClone(defaults);
  try { return { ...structuredClone(defaults), ...JSON.parse(raw) }; }
  catch { return structuredClone(defaults); }
}

async function writeContent(content) {
  await store.set("content", JSON.stringify(content), { onlyIfNew: false });
}

function sign(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function cookieValue(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const item = cookieHeader.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`));
  return item ? item.slice(COOKIE.length + 1) : "";
}

function isAdmin(request) {
  const secret = process.env.CVL_SESSION_SECRET;
  if (!secret) return false;
  const [payload, signature] = cookieValue(request).split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload, secret);
  const providedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) return false;
  const [expires] = Buffer.from(payload, "base64url").toString().split(":");
  return Number(expires) > Date.now();
}

function setSessionCookie(request) {
  const secret = process.env.CVL_SESSION_SECRET;
  const expires = Date.now() + 8 * 60 * 60 * 1000;
  const payload = Buffer.from(`${expires}:${randomBytes(24).toString("hex")}`).toString("base64url");
  const signature = sign(payload, secret);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${payload}.${signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`;
}

function validId(id) { return typeof id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(id); }

function cleanText(value, max) { return String(value ?? "").trim().slice(0, max); }

function cleanContent(input, existing) {
  if (!input || typeof input !== "object") throw new Error("Contenu invalide.");
  const out = {};
  const rules = {
    news: ["title", "label", "text", "date"],
    meetings: ["title", "date", "fileName"],
    projects: ["title", "text", "status"],
    members: ["name", "className", "role", "contact"],
    contacts: ["category", "value", "url"],
    messages: ["subject", "message", "sender", "email", "date"]
  };
  for (const [collection, fields] of Object.entries(rules)) {
    const source = input[collection];
    if (!Array.isArray(source)) throw new Error(`Liste invalide : ${collection}`);
    if (source.length > 1000) throw new Error("Trop d’éléments.");
    out[collection] = source.map(item => {
      if (!item || !validId(item.id)) throw new Error("Identifiant invalide.");
      const clean = { id: item.id };
      for (const field of fields) clean[field] = cleanText(item[field], field === "message" || field === "text" ? 4000 : 300);
      return clean;
    });
  }
  // Keep private submissions out of generic content writes unless a signed-in admin sent the list.
  out.messages = out.messages || existing.messages || [];
  return out;
}

export default async function handler(request) {
  const url = new URL(request.url);
  const pdfId = url.searchParams.get("pdf");

  try {
    if (request.method === "GET" && pdfId) {
      if (!validId(pdfId)) return fail("Identifiant PDF invalide.", 400);
      const pdf = await store.get(`pdf:${pdfId}`, { type: "arrayBuffer", consistency: "strong" });
      if (!pdf) return fail("PDF introuvable.", 404);
      return new Response(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": "inline", "Cache-Control": "public, max-age=60" } });
    }

    if (request.method === "PUT" && pdfId) {
      if (!isAdmin(request)) return fail("Connexion requise.", 401);
      if (!validId(pdfId) || !(request.headers.get("content-type") || "").includes("application/pdf")) return fail("Fichier PDF invalide.", 415);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength > MAX_PDF_BYTES) return fail("Le PDF dépasse la limite de 5 Mo.", 413);
      if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return fail("Le fichier n’est pas un PDF valide.", 415);
      await store.set(`pdf:${pdfId}`, bytes);
      return json({ ok: true });
    }

    if (request.method === "DELETE" && pdfId) {
      if (!isAdmin(request)) return fail("Connexion requise.", 401);
      if (!validId(pdfId)) return fail("Identifiant PDF invalide.", 400);
      await store.delete(`pdf:${pdfId}`);
      return json({ ok: true });
    }

    if (request.method === "GET") {
      const authenticated = isAdmin(request);
      const content = await readContent();
      if (!authenticated) delete content.messages;
      return json({ content, authenticated });
    }

    if (request.method !== "POST") return fail("Méthode non prise en charge.", 405);
    const body = await request.json();

    if (body.action === "login") {
      const password = process.env.CVL_ADMIN_PASSWORD;
      const secret = process.env.CVL_SESSION_SECRET;
      if (!password || !secret) return fail("Configuration du compte administrateur manquante.", 503);
      if (typeof body.password !== "string" || body.password !== password) return fail("Mot de passe incorrect.", 401);
      return json({ content: await readContent(), authenticated: true }, 200, { "Set-Cookie": setSessionCookie(request), "Cache-Control": "no-store" });
    }

    if (body.action === "logout") {
      return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }

    if (body.action === "message") {
      const message = body.message || {};
      const subject = cleanText(message.subject, 120);
      const text = cleanText(message.message, 3000);
      if (!subject || !text) return fail("Sujet et message sont obligatoires.");
      const content = await readContent();
      content.messages.push({ id: crypto.randomUUID(), subject, message: text, sender: cleanText(message.sender, 80), email: cleanText(message.email, 160), date: new Date().toISOString().slice(0, 10) });
      content.messages = content.messages.slice(-500);
      await writeContent(content);
      return json({ ok: true });
    }

    if (body.action === "save") {
      if (!isAdmin(request)) return fail("Connexion requise.", 401);
      const existing = await readContent();
      const content = cleanContent(body.content, existing);
      await writeContent(content);
      return json({ ok: true });
    }

    return fail("Action inconnue.", 400);
  } catch (error) {
    console.error("CVL function error", error);
    return fail("Erreur interne du site.", 500);
  }
}
