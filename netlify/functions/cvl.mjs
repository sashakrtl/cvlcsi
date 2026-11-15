import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";

const store = getStore({ name: "cvl-csi", region: "eu-central-1" });
const COOKIE = "cvl_admin";
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const defaults = {
  news: [{ id: "n1", title: "Bienvenue sur le site du CVL", text: "Retrouvez ici les nouvelles du Conseil de la vie lycéenne, les projets qui prennent vie et les prochains rendez-vous.", date: new Date().toISOString().slice(0, 10), label: "La vie du CVL" }],
  meetings: [],
  journals: [],
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
    news: ["title", "label", "text", "date", "fileName", "fileType"],
    meetings: ["title", "date", "fileName"],
    journals: ["title", "date", "fileName"],
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
    const fileId = url.searchParams.get("file");
    if (request.method === "GET" && (pdfId || fileId)) {
      const id = pdfId || fileId;
      if (!validId(id)) return fail("Identifiant de fichier invalide.", 400);
      const key = pdfId ? `pdf:${id}` : `file:${id}`;
      const file = await store.get(key, { type: "arrayBuffer", consistency: "strong" });
      if (!file) return fail("Fichier introuvable.", 404);
      let contentType = "application/pdf";
      if (fileId) {
        const metaRaw = await store.get(`file-meta:${id}`, { type: "text", consistency: "strong" });
        try { contentType = JSON.parse(metaRaw || "{}").contentType || "application/octet-stream"; } catch { contentType = "application/octet-stream"; }
      }
      return new Response(file, { headers: { "Content-Type": contentType, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=60" } });
    }

    if (request.method === "PUT" && (pdfId || fileId)) {
      if (!isAdmin(request)) return fail("Connexion requise.", 401);
      const id = pdfId || fileId;
      const contentType = (request.headers.get("content-type") || "").split(";")[0].toLowerCase();
      const accepted = pdfId ? contentType === "application/pdf" : ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType);
      if (!validId(id) || !accepted) return fail("Type de fichier invalide.", 415);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength > MAX_PDF_BYTES) return fail("Le fichier dépasse la limite de 5 Mo.", 413);
      const signature = new TextDecoder().decode(bytes.slice(0, 12));
      const validSignature = contentType === "application/pdf" ? signature.startsWith("%PDF-")
        : contentType === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : contentType === "image/png" ? bytes[0] === 0x89 && signature.slice(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
        : contentType === "image/gif" ? signature.startsWith("GIF87a") || signature.startsWith("GIF89a")
        : contentType === "image/webp" ? signature.slice(0, 4) === "RIFF" && signature.slice(8, 12) === "WEBP" : false;
      if (!validSignature) return fail("Le fichier ne semble pas valide.", 415);
      if (pdfId) await store.set(`pdf:${id}`, bytes);
      else {
        await store.set(`file:${id}`, bytes);
        await store.set(`file-meta:${id}`, JSON.stringify({ contentType }));
      }
      return json({ ok: true });
    }

    if (request.method === "DELETE" && (pdfId || fileId)) {
      if (!isAdmin(request)) return fail("Connexion requise.", 401);
      const id = pdfId || fileId;
      if (!validId(id)) return fail("Identifiant de fichier invalide.", 400);
      await store.delete(pdfId ? `pdf:${id}` : `file:${id}`);
      if (fileId) await store.delete(`file-meta:${id}`);
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
