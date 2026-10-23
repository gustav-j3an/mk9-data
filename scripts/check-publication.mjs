import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const runGit = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

export function parseGithubRepository(remoteUrl) {
  const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function parseBuildMetadata(html) {
  const read = (name) => html.match(new RegExp(`<meta\\s+name=["']mk9-build-${name}["']\\s+content=["']([^"']*)["']`, 'i'))?.[1] ?? null;
  return { version: read('version'), commit: read('commit'), ref: read('ref') };
}

export function summarizeRelation(mainOnly, recoveryOnly) {
  if (mainOnly === 0 && recoveryOnly === 0) return 'sincronizadas';
  if (mainOnly === 0 && recoveryOnly > 0) return `desenvolvimento ${recoveryOnly} commit(s) à frente`;
  if (mainOnly > 0 && recoveryOnly === 0) return `desenvolvimento ${mainOnly} commit(s) atrás`;
  return `divergentes (${mainOnly} exclusivos em main, ${recoveryOnly} exclusivos em recovery)`;
}

async function githubApi(url) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'mk9-publication-check' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GitHub API respondeu HTTP ${response.status}`);
  return response.json();
}

async function readVercelApi(projectId, token, teamId) {
  const suffix = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  const response = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(projectId)}${suffix}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Vercel API respondeu HTTP ${response.status}`);
  return response.json();
}

export async function checkPublication() {
  const branch = runGit(['branch', '--show-current']);
  const localSha = runGit(['rev-parse', 'HEAD']);
  const localStatus = runGit(['status', '--short']);
  const originUrl = runGit(['remote', 'get-url', 'origin']);
  const repository = parseGithubRepository(originUrl);
  const devRef = 'origin/recovery/mk9-date-completo';
  const prodRef = 'origin/main';
  const devSha = runGit(['rev-parse', '--verify', devRef]);
  const prodSha = runGit(['rev-parse', '--verify', prodRef]);
  const [mainOnly, recoveryOnly] = runGit(['rev-list', '--left-right', '--count', `${prodRef}...${devRef}`]).split(/\s+/).map(Number);

  console.log('MK9 Date — verificação somente leitura da publicação');
  console.log(`Branch local: ${branch} (${localSha.slice(0, 7)})${localStatus ? ' • com alterações locais' : ' • limpa'}`);
  console.log(`GitHub recovery: ${devSha.slice(0, 7)}`);
  console.log(`GitHub main: ${prodSha.slice(0, 7)}`);
  console.log(`Relação main → recovery: ${summarizeRelation(mainOnly, recoveryOnly)}`);

  if (!repository) {
    console.log('Deployment: repositório origin não é GitHub; status indisponível.');
  } else {
    try {
      const deployments = await githubApi(`https://api.github.com/repos/${repository}/deployments?environment=Production&per_page=10`);
      const production = deployments.filter((item) => item.environment?.toLowerCase() === 'production' || item.original_environment?.toLowerCase() === 'production');
      if (!production.length) console.log('Deployment GitHub/Vercel: nenhum registro de produção encontrado.');
      else {
        const latest = production.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
        const statuses = await githubApi(latest.statuses_url);
        const status = statuses[0];
        console.log(`Deployment GitHub/Vercel: ${status?.state ?? 'sem status'} • commit ${latest.sha.slice(0, 7)} • ${latest.created_at}`);
        if (status?.environment_url) {
          try {
            const target = await fetch(status.environment_url, { redirect: 'follow', cache: 'no-store' });
            console.log(`URL do deployment: HTTP ${target.status} • ${status.environment_url}`);
          } catch (error) {
            console.log(`URL do deployment: inacessível (${error.message}) • ${status.environment_url}`);
          }
        }
      }
    } catch (error) {
      console.log(`Deployment GitHub/Vercel: indisponível (${error.message}).`);
    }
  }

  try {
    const response = await fetch('https://mk9-date.vercel.app/', { cache: 'no-store' });
    const html = await response.text();
    const build = parseBuildMetadata(html);
    console.log(`Domínio público: HTTP ${response.status} • commit ${build.commit ?? 'ainda sem marcador de build'} • versão ${build.version ?? 'desconhecida'} • ref ${build.ref ?? 'desconhecida'}`);
    console.log(`Cache do domínio: Age=${response.headers.get('age') ?? 'n/d'} • Vercel=${response.headers.get('x-vercel-cache') ?? 'n/d'}`);
  } catch (error) {
    console.log(`Domínio público: indisponível (${error.message}).`);
  }

  if (process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID) {
    try {
      const project = await readVercelApi(process.env.VERCEL_PROJECT_ID, process.env.VERCEL_API_TOKEN, process.env.VERCEL_TEAM_ID);
      console.log(`Production Branch Vercel: ${project.productionBranch ?? 'não configurada'}`);
    } catch (error) {
      console.log(`Configuração Vercel: indisponível (${error.message}).`);
    }
  } else {
    console.log('Production Branch Vercel: configure VERCEL_API_TOKEN e VERCEL_PROJECT_ID para leitura autenticada; nenhuma credencial será exibida.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await checkPublication(); }
  catch (error) {
    console.error(`Verificação incompleta: ${error.message}`);
    process.exitCode = 1;
  }
}
