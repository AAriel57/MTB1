// Chatbot de Moarlovers: recibe la conversación desde la web y responde con Claude.
// La API key de Anthropic vive como secreto de Supabase (ANTHROPIC_API_KEY), nunca en la web.
import Anthropic from "npm:@anthropic-ai/sdk@1.1.0";

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

// Opcional: limita qué web puede llamar a la función (p. ej. https://aariel57.github.io).
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";
const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_TURNS = 20;
const MAX_CHARS = 1500;

const SYSTEM = `Eres el asistente de Moarlovers, una marca española que vende Lingote: un juego de cama de vinilo dorado para adultos (+18). Atiendes en la web de la tienda.

Datos del producto (no inventes nada fuera de esto):
- El juego incluye una sábana bajera ajustable de vinilo dorado y 2 fundas de almohada de 50 × 75 cm.
- Vinilo premium: lámina flexible con acabado espejo, suave, sin olor. Repelente al agua: lubricantes a base de agua, cremas de masaje y otros líquidos resbalan y el colchón queda seco.
- Bajera con elástico en todo el perímetro, para colchones de hasta 30 cm de alto (topper incluido).
- No da calor: al principio está fresco y enseguida toma la temperatura del cuerpo. Hace muy poco ruido.
- Diseñado y fabricado en España, en series cortas; cada juego se revisa a mano.
- Precio: 219 € (IVA incluido) para la medida estándar 150 × 190 cm. Las medidas 135 × 190, 150 × 200, 160 × 200, 180 × 200 y 200 × 200 se hacen bajo pedido; para precio y plazo hay que escribir a la tienda. También se hacen medidas a medida en el taller.
- Envío discreto en 48/72 h, incluido: caja neutra sin logotipos ni descripción; en el remitente solo aparecen unas iniciales.
- Cuidados: tras cada uso, recoger los líquidos con una microfibra, doblar y guardar. Lavado en ciclo corto con agua fría. No usar acondicionador. No planchar. Secar a la sombra.
- Ritual sugerido: tensar la bajera, luz cálida tenue, música lenta (la web enlaza la playlist "Lingote Music · Deep House Chill" en Spotify).

Cómo responder:
- En el idioma del cliente (por defecto, español), con un tono cálido, elegante y discreto. Respuestas breves: 1 a 4 frases, sin listas largas ni encabezados.
- Para comprar, indica que elija la medida en la sección "Elige tu medida" de la página y pulse "Añadir a la cesta".
- Si no sabes algo (stock exacto, estado de un pedido, devoluciones, formas de pago, datos de contacto), dilo con naturalidad y sugiere escribir a la tienda; no inventes políticas, precios, emails ni teléfonos.
- No puedes hacer pedidos, cobrar ni ver datos de clientes.
- Puedes hablar con naturalidad del uso íntimo del producto, sin contenido explícito.
- Si te preguntan algo ajeno a Moarlovers, reconduce amablemente la conversación.`;

type Turn = { role: "user" | "assistant"; content: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  let turns: Turn[];
  try {
    const body = await req.json();
    turns = (Array.isArray(body?.messages) ? body.messages : [])
      .filter((m: Turn) =>
        (m?.role === "user" || m?.role === "assistant") &&
        typeof m.content === "string" && m.content.trim()
      )
      .slice(-MAX_TURNS)
      .map((m: Turn) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  } catch {
    return json({ error: "Petición no válida" }, 400);
  }
  // La API exige empezar por un mensaje del usuario.
  while (turns.length && turns[0].role !== "user") turns.shift();
  if (!turns.length || turns[turns.length - 1].role !== "user") {
    return json({ error: "Falta el mensaje del usuario" }, 400);
  }

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 1024,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: turns,
    });

    if (response.stop_reason === "refusal") {
      return json({ reply: "Prefiero no responder a eso. ¿Te ayudo con algo sobre Lingote?" });
    }
    const reply = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    return json({ reply: reply || "Perdona, no he podido responder. ¿Puedes repetirlo?" });
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: "Hay mucha demanda ahora mismo. Inténtalo en un momento." }, 429);
    }
    if (err instanceof Anthropic.APIError) {
      return json({ error: "El asistente no está disponible ahora mismo." }, 502);
    }
    return json({ error: "Error inesperado." }, 500);
  }
});
