// Servicio de envío de correos de PRISMA 2027 (ANAI Online).
// Recibe pedidos de la plataforma y los envía por el SMTP de Microsoft 365.
// La contraseña del correo se configura en Render (variable SMTP_PASS); no está en este archivo.
const http = require("http");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const {
  SMTP_HOST = "smtp.office365.com",
  SMTP_PORT = "587",
  SMTP_USER,
  SMTP_PASS,
  RELAY_TOKEN,
  REMITENTE_NOMBRE = "PRISMA 2027 · ANAI Online",
  PORT = "10000",
} = process.env;

const transporte = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: Number(SMTP_PORT) === 465,
  requireTLS: Number(SMTP_PORT) !== 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 60000,
});

function responder(res, estado, cuerpo) {
  res.writeHead(estado, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(cuerpo));
}

function tokenValido(cabecera) {
  if (!RELAY_TOKEN) return false;
  const recibido = Buffer.from(String(cabecera || "").replace(/^Bearer\s+/i, ""));
  const esperado = Buffer.from(RELAY_TOKEN);
  return recibido.length === esperado.length && crypto.timingSafeEqual(recibido, esperado);
}

function leerCuerpo(req) {
  return new Promise((ok, mal) => {
    let datos = "";
    req.on("data", (c) => {
      datos += c;
      if (datos.length > 300000) { mal(new Error("Mensaje demasiado grande")); req.destroy(); }
    });
    req.on("end", () => ok(datos));
    req.on("error", mal);
  });
}

const servidor = http.createServer(async (req, res) => {
  if (req.method === "GET") {
    return responder(res, 200, { ok: true, servicio: "prisma-correo", configurado: Boolean(SMTP_USER && SMTP_PASS && RELAY_TOKEN) });
  }
  if (req.method !== "POST" || req.url !== "/enviar") return responder(res, 404, { error: "No encontrado" });
  if (!tokenValido(req.headers.authorization)) return responder(res, 401, { error: "No autorizado" });
  if (!SMTP_USER || !SMTP_PASS) return responder(res, 500, { error: "Falta configurar SMTP_USER o SMTP_PASS en Render" });

  let pedido;
  try { pedido = JSON.parse(await leerCuerpo(req)); } catch { return responder(res, 400, { error: "Pedido no válido" }); }
  const { para, asunto, html, texto } = pedido || {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(para || ""))) return responder(res, 400, { error: "Destinatario no válido" });
  if (!asunto || !html) return responder(res, 400, { error: "Faltan el asunto o el contenido" });

  const inicio = Date.now();
  try {
    const info = await transporte.sendMail({
      from: { name: REMITENTE_NOMBRE, address: SMTP_USER },
      to: para,
      subject: String(asunto).slice(0, 200),
      html: String(html),
      text: texto ? String(texto) : undefined,
    });
    console.log(`Enviado a ${para} en ${Date.now() - inicio} ms`);
    responder(res, 200, { ok: true, id: info.messageId, ms: Date.now() - inicio });
  } catch (e) {
    console.error(`Falló el envío a ${para}: ${e.message}`);
    responder(res, 502, { error: e.message });
  }
});

servidor.listen(Number(PORT), () => console.log(`prisma-correo escuchando en el puerto ${PORT}`));
