import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    // 1. Verify Authorization Header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Autorização ausente.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // 2. Authenticate User and Check Admin Role
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida ou expirada.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Apenas administradores podem enviar convites por e-mail.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Parse Request Payload
    const { name, email, tempPassword } = await req.json();
    if (!name || !email || !tempPassword) {
      return new Response(JSON.stringify({ error: 'Dados incompletos para envio de e-mail.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If Resend API key is missing, return friendly failure response
    if (!resendApiKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY não configurada no Supabase Secrets.', emailSent: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Send Email via Resend REST API
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'MK9 Trade Marketing <onboarding@resend.dev>',
        to: [email],
        subject: 'Seu acesso ao MK9 foi criado',
        html: `
          <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #0d1117; color: #e6edf3; border-radius: 12px; border: 1px solid #30363d;">
            <h2 style="color: #a371f7; margin-top: 0; font-size: 20px;">MK9 COMMAND CENTER</h2>
            <p style="font-size: 14px; line-height: 1.5;">Olá, <strong>${name}</strong>.</p>
            <p style="font-size: 14px; line-height: 1.5;">Seu acesso ao sistema MK9 foi criado.</p>
            
            <div style="background-color: #161b22; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #30363d;">
              <p style="margin: 6px 0; font-size: 13px;"><strong>Link de acesso:</strong> <a href="https://mk9-date.vercel.app/login" style="color: #58a6ff; font-weight: bold;">https://mk9-date.vercel.app/login</a></p>
              <p style="margin: 6px 0; font-size: 13px;"><strong>Login:</strong> ${email}</p>
              <p style="margin: 6px 0; font-size: 13px;"><strong>Senha temporária:</strong> <span style="font-family: monospace; font-size: 15px; color: #f2cc60; background-color: #21262d; padding: 4px 10px; border-radius: 4px; font-weight: bold;">${tempPassword}</span></p>
            </div>

            <p style="font-size: 12px; color: #8b949e; line-height: 1.4;">Por segurança, no primeiro acesso você será obrigado a criar uma nova senha pessoal.</p>
            <hr style="border: 0; border-top: 1px solid #30363d; margin: 20px 0;" />
            <p style="font-size: 12px; color: #8b949e; margin-bottom: 0;">Atenciosamente,<br /><strong>MK9 Trade Marketing</strong></p>
          </div>
        `,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      return new Response(JSON.stringify({ error: resendData.message || 'Falha no provedor de e-mail.', emailSent: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, emailSent: true, id: resendData.id }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message, emailSent: false }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
