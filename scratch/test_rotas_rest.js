const https = require('https');

const options = {
  hostname: 'xzmbesqhxcnuokjwrbnw.supabase.co',
  path: '/rest/v1/rotas?select=*&limit=1',
  method: 'GET',
  headers: {
    'apikey': 'sb_publishable_0m14d_Wldem4-jgv6ODOPw_QDLoFfF_',
    'Authorization': 'Bearer sb_publishable_0m14d_Wldem4-jgv6ODOPw_QDLoFfF_'
  },
  timeout: 8000
};

console.log('Enviando requisição para Supabase...');

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (d) => { body += d; });
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('HEADERS:', res.headers);
    console.log('BODY:', body);
    process.exit(0);
  });
});

req.on('timeout', () => {
  console.error('TIMEOUT atingido');
  req.destroy();
  process.exit(1);
});

req.on('error', (e) => {
  console.error('ERRO:', e.message);
  process.exit(1);
});

req.end();

