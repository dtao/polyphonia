import type { Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const ALLOWED_EMAILS_RAW = process.env.ALLOWED_EMAILS ?? "";

const allowedEmails: Set<string> | null = ALLOWED_EMAILS_RAW
  ? new Set(ALLOWED_EMAILS_RAW.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean))
  : null;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let email: string;
  try {
    ({ email } = JSON.parse(event.body ?? "{}"));
    if (typeof email !== "string" || !email.trim()) throw new Error();
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  const normalized = email.trim().toLowerCase();

  if (allowedEmails && !allowedEmails.has(normalized)) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: "This email address isn't on the creator access list." }),
    };
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { statusCode: 503, body: JSON.stringify({ error: "Auth is not configured." }) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await supabase.auth.signInWithOtp({
    email: normalized,
    options: { emailRedirectTo: event.headers.origin ?? "" },
  });

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
