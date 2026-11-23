// qinlv-ip-query — IP 查询 Worker
// 访客 IP 用 Cloudflare request.cf（免费、无外部调用）；任意 IP 查 ip-api.com（免费免 Key，
// 失败时回退 ipinfo.io），地理数据经 Workers 缓存 24 小时。
// ASN 用 RIPEstat（免费免 Key），rDNS / 域名解析用 dns.google DoH。
// 功能：/api/lookup、/api/rdap、/api/dns-multi、/api/resolve、/api/rdns、/api/asn、/api/me。
// SEO：Top IP 落地页服务端渲染（可收录），其余 /ip/ 走 SPA + X-Robots-Tag: noindex；
// robots.txt / sitemap.xml / manifest 在 public/；统计用 Cloudflare Web Analytics（beacon）。
// 纯净度评分是本站自定透明规则（基础 100 分扣分制），非官方评分。

const IP_API_FIELDS = 'status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,mobile,proxy,hosting,query';
const JSON_HDR_SHORT = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' };
const JSON_HDR_LONG = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=86400' };

function json(data, status = 200, maxAge = 60) {
  const headers = maxAge >= 86400 ? JSON_HDR_LONG : JSON_HDR_SHORT;
  return new Response(JSON.stringify(data), { status, headers });
}

// SEO 落地页白名单：高频公共 DNS 与知名 IP（50–100 个，只给这些做服务端渲染；其余 /ip/ 不收录）
const TOP_IPS = [
  '8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1', '9.9.9.9', '149.112.112.112',
  '114.114.114.114', '114.114.115.115', '223.5.5.5', '223.6.6.6',
  '180.76.76.76', '119.29.29.29', '182.254.116.116', '140.205.19.6',
  '208.67.222.222', '208.67.220.220', '64.6.64.6', '64.6.65.6',
  '77.88.8.8', '77.88.8.1', '80.80.80.80', '80.80.81.81',
  '4.2.2.1', '4.2.2.2', '4.2.2.3', '4.2.2.4', '8.26.56.26',
  '84.200.69.80', '84.200.70.40', '91.239.100.100',
  '195.46.39.39', '195.46.39.40', '185.121.177.177', '185.121.177.53',
  '76.76.2.0', '76.76.10.0', '94.140.14.14', '94.140.15.15',
  '218.30.19.40', '61.139.2.69', '202.96.128.86', '202.96.128.166',
  '211.137.32.178', '221.5.88.88', '219.141.136.10', '219.141.140.10',
  '202.102.192.68', '202.102.199.68', '211.136.192.6', '221.130.33.52',
  '218.104.111.114', '202.101.172.35', '61.177.7.1', '202.98.0.68',
  '222.222.222.222', '180.168.255.18', '116.116.116.116',
  '1.2.4.8', '210.2.4.8', '101.226.4.6', '168.95.1.1',
];
function isIP(s) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(s) || /^[0-9a-fA-F:]+$/.test(s) && s.includes(':');
}
function isIPv4(s) { return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(s); }

// 带超时的 fetch：任一上游慢也不拖垮整次查询
async function fetchJSON(url, ms = 5000, headers = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'qinlv-ip-query/2.0', ...headers } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function normalizeIpApi(d) {
  return {
    source: 'ip-api.com', ip: d.query, country: d.country || '', countryCode: d.countryCode || '',
    region: d.regionName || d.region || '', city: d.city || '', zip: d.zip || '',
    lat: d.lat ?? null, lon: d.lon ?? null, timezone: d.timezone || '',
    isp: d.isp || '', org: d.org || '', as: d.as || '', asname: d.asname || '',
    mobile: !!d.mobile, proxy: !!d.proxy, hosting: !!d.hosting,
  };
}

async function fetchIpApi(ip) {
  const d = await fetchJSON(`https://ip-api.com/json/${encodeURIComponent(ip)}?fields=${IP_API_FIELDS}`);
  if (d.status !== 'success') throw new Error(d.message || 'ip-api 查询失败');
  return normalizeIpApi(d);
}

async function fetchIpinfo(ip) {
  const d = await fetchJSON(`https://ipinfo.io/${encodeURIComponent(ip)}/json`);
  if (!d.ip) throw new Error('ipinfo 无数据');
  const [lat, lon] = String(d.loc || ',').split(',').map(Number);
  const orgParts = String(d.org || '').match(/^(AS\d+)\s+(.*)$/);
  return { source: 'ipinfo.io', ip: d.ip, country: d.country || '', countryCode: d.country || '', region: d.region || '', city: d.city || '', zip: d.postal || '', lat: lat || null, lon: lon || null, timezone: d.timezone || '', isp: orgParts ? orgParts[2] : (d.org || ''), org: d.org || '', as: orgParts ? orgParts[1] : '', asname: orgParts ? orgParts[2] : '', mobile: false, proxy: false, hosting: false };
}

async function lookupIP(ip) {
  try { return await fetchIpApi(ip); }
  catch (e) { /* fall through to ipinfo */ }
  try { return await fetchIpinfo(ip); }
  catch (e) {}
  return { error: 'lookup_failed', message: '上游查询失败，请稍候再试' };
}

// 地理数据 24 小时缓存（ip-api / ipinfo 的归属地一年都不怎么变）
async function cachedLookup(ip, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(`https://lookup.qinlv/${ip}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit.json();
  const data = await lookupIP(ip);
  if (data.error) return data;
  ctx.waitUntil(cache.put(cacheKey, json(data, 200, 86400).clone()));
  return data;
}

// ---- SSR 落地页 ----
function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const IDC_ORGS = ['google', 'cloudflare', 'amazon', 'microsoft', 'oracle', 'alibaba', 'tencent', 'cloud', 'hosting', 'cdn', 'vultr', 'linode', 'digitalocean', 'hetzner', 'ovh', 'datacenter', 'data center'];
function isIdcOrg(org) {
  const o = String(org || '').toLowerCase();
  return IDC_ORGS.some(k => o.includes(k));
}
function ssrPurity(d) {
  let score = 100;
  const rows = [];
  if (d.proxy) { score -= 40; rows.push(['代理 IP', '-40', '该 IP 被识别为代理出口。']); }
  if (d.hosting) { score -= 40; rows.push(['托管 / 机房 IP', '-40', '该 IP 属于托管或机房网段，非家庭宽带。']); }
  else if (isIdcOrg(d.org || d.asname)) { score -= 25; rows.push(['机房组织', '-25', '所属组织为云厂商或机房运营商。']); }
  const grade = score >= 90 ? '优秀' : score >= 70 ? '良好' : score >= 50 ? '一般' : score >= 30 ? '较差' : '高风险';
  return { score, grade, rows };
}
function ptrName(ip) {
  if (isIPv4(ip)) return `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
  const [head, tail] = ip.split('::');
  const h = (head ? head.split(':') : []).filter(Boolean);
  const t = (tail ? tail.split(':') : []).filter(Boolean);
  const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t].map(g => g.padStart(4, '0')).join('');
  if (full.length !== 32) return '';
  return `${full.split('').reverse().join('.')}.ip6.arpa`;
}
function notFoundPage() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>页面不存在 · 钦律亲为 IP 查询</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:#0F172A;color:#E2E8F0;margin:0;padding:48px 20px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#94A3B8;margin:0 0 24px}form{display:flex;gap:8px;max-width:520px;margin:0 auto 24px}input{flex:1;padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#1E293B;color:#E2E8F0;font-size:15px}button{padding:12px 20px;border-radius:10px;border:0;background:#0D9488;color:#fff;font-size:15px;cursor:pointer}a{color:#14B8A6;text-decoration:none}</style></head><body><h1>404 · 这个页面不存在</h1><p>你可以直接查一个 IP、域名或 ASN：</p><form onsubmit="var q=document.getElementById('q').value.trim();if(q)location.href='/ip/'+encodeURIComponent(q);return false;"><input id="q" placeholder="输入 IP、域名或 ASN，例如 8.8.8.8"><button type="submit">查询</button></form><p><a href="/">← 返回钦律亲为 IP 查询首页</a></p></body></html>`;
}
async function renderLanding(request, env, ctx, ip) {
  const cache = caches.default;
  const cacheKey = new Request(`https://ssr.qinlv/v2/ip/${ip}`);
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const data = await cachedLookup(ip, ctx);
  if (data.error) return null; // 上游失败时回落到 SPA，不出坏页
  let host = '';
  try {
    const name = ptrName(ip);
    if (name) {
      const r = await fetch(`https://dns.google/resolve?name=${name}&type=PTR`, { signal: AbortSignal.timeout(4000) });
      const d = await r.json();
      host = (d.Answer || [])[0]?.data?.replace(/\.$/, '') || '';
    }
  } catch (e) {}
  const base = await env.ASSETS.fetch(new Request(new URL('/', request.url), request));
  let html = await base.text();
  const loc = [data.country, data.region, data.city].filter(Boolean).join(' ');
  const isp = data.isp || data.org || '';
  const title = `${ip} 归属地查询 | ${loc}${isp ? ' ' + isp : ''} · 钦律亲为 IP 查询`;
  const desc = `${ip} 归属地：${loc}，运营商 ${isp}，${data.as || ''}，时区 ${data.timezone || ''}。免费查询 IP 归属地、ASN、纯净度评分。`;
  const badges = [];
  if (data.proxy) badges.push('代理 IP');
  if (data.hosting) badges.push('IDC 机房 IP');
  else if (isIdcOrg(data.org || data.asname)) badges.push('IDC 机房 IP');
  if (data.mobile) badges.push('移动网络');
  const p = ssrPurity(data);
  const rows = [
    ['归属地', loc || '—'], ['国家 / 代码', data.country ? `${data.country} / ${data.countryCode}` : '—'],
    ['城市 / 邮编', [data.city, data.zip].filter(Boolean).join(' / ') || '—'],
    ['经纬度', (data.lat != null && data.lon != null) ? `${data.lat}, ${data.lon}` : '—'],
    ['时区', data.timezone || '—'], ['运营商', isp || '—'], ['组织', data.org || '—'],
    ['ASN', data.as ? `${data.as}${data.asname ? ' · ' + data.asname : ''}` : '—'],
    ['主机名', host || '—'], ['数据来源', data.source || '—'],
  ].map(([k, v]) => `<tr><td>${escHtml(k)}</td><td>${escHtml(v)}</td></tr>`).join('');
  const mapLink = (data.lat != null && data.lon != null)
    ? `<p><a href="https://www.openstreetmap.org/?mlat=${data.lat}&mlon=${data.lon}#map=10/${data.lat}/${data.lon}">在 OpenStreetMap 上查看 →</a></p>` : '';
  const card = `<div class="card"><div class="big-ip">${escHtml(ip)}</div><p class="muted">这是 ${escHtml(ip)} 的归属地信息</p>${badges.length ? `<div class="badges">${badges.map(b => `<span class="badge">${escHtml(b)}</span>`).join('')}</div>` : ''}<table class="kv">${rows}</table>${mapLink}</div>`;
  const purityRows = p.rows.map(([label, pts, ex]) => `<tr><td>${escHtml(label)}<br><span class="muted" style="font-size:12px">${escHtml(ex)}</span></td><td>${escHtml(pts)}</td></tr>`).join('')
    || `<tr><td>无扣分项</td><td>0</td></tr>`;
  const purityCard = `<div class="card"><h2>IP 纯净度评分</h2><div style="font-size:40px;font-weight:800;color:var(--accent)">${p.score} / 100 · ${p.grade}</div><p class="muted">本站自定规则，仅供参考，非官方评分。基础 100 分，按下列信号扣分。</p><table class="kv">${purityRows}</table></div>`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'WebPage',
    name: `${ip} 归属地查询`, description: desc,
    url: `https://ip.sungongqin.com/ip/${ip}`,
    about: { '@type': 'Place', name: loc, address: { '@type': 'PostalAddress', addressCountry: data.countryCode || '', addressLocality: data.city || '' } },
  };
  html = html.replace(/<title>.*?<\/title>/, `<title>${escHtml(title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escHtml(desc)}">`);
  html = html.replace('<link rel="canonical" href="https://ip.sungongqin.com/">', `<link rel="canonical" href="https://ip.sungongqin.com/ip/${ip}">`);
  html = html.replace('<link rel="alternate" hreflang="zh-CN" href="https://ip.sungongqin.com/">', `<link rel="alternate" hreflang="zh-CN" href="https://ip.sungongqin.com/ip/${ip}">`);
  html = html.replace('<link rel="alternate" hreflang="en" href="https://ip.sungongqin.com/?lang=en">', `<link rel="alternate" hreflang="en" href="https://ip.sungongqin.com/ip/${ip}?lang=en">`);
  html = html.replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${escHtml(title)}">`);
  html = html.replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${escHtml(desc)}">`);
  html = html.replace('<meta property="og:url" content="https://ip.sungongqin.com/">', `<meta property="og:url" content="https://ip.sungongqin.com/ip/${ip}">`);
  html = html.replace(/<script type="application\/ld\+json" id="ldjson">[\s\S]*?<\/script>/, `<script type="application/ld+json" id="ldjson">${JSON.stringify(ld)}</script>`);
  html = html.replace('<div id="result"></div>', `<div id="result">${card}</div>`);
  html = html.replace('<div id="purity"></div>', `<div id="purity">${purityCard}</div>`);
  const res = new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=86400' } });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

// ---- RDAP ----
function vcardValue(vcard, field) {
  if (!Array.isArray(vcard)) return '';
  const props = vcard[1] || [];
  const hit = props.find(p => p[0] === field);
  return hit ? hit[3] : '';
}
function vcardEmail(vcard) {
  const v = vcardValue(vcard, 'email');
  return String(v || '').replace(/^mailto:/, '');
}
function normalizeRdap(query, type, d) {
  const entities = (d.entities || []).map(e => ({
    roles: e.roles || [],
    name: vcardValue(e.vCardArray, 'fn'),
    email: vcardEmail(e.vCardArray),
    handle: e.handle || '',
  }));
  const events = (d.events || []).map(e => ({ action: e.eventAction || '', date: e.eventDate || '' }));
  const reg = events.find(e => e.action === 'registration');
  const changed = events.find(e => e.action === 'last changed');
  const abuse = entities.find(e => (e.roles || []).includes('abuse'));
  const registrant = entities.find(e => (e.roles || []).includes('registrant'));
  const cidrs = (d.cidr0_cidrs || []).map(c => c.v4prefix ? `${c.v4prefix}/${c.length}` : (c.v6prefix ? `${c.v6prefix}/${c.length}` : '')).filter(Boolean);
  return {
    query, type, source: 'rdap.org', objectClassName: d.objectClassName || '',
    handle: d.handle || '', name: d.name || registrant?.name || '',
    startAddress: d.startAddress || '', endAddress: d.endAddress || '',
    ipVersion: d.ipVersion || '', status: d.status || [],
    registration: reg?.date || '', lastChanged: changed?.date || '',
    entities, abuseEmail: abuse?.email || '',
    cidrs, port43: d.port43 || '',
    remarks: (d.remarks || []).flatMap(r => r.description || []),
  };
}

// RDAP 兜底：rdap.org 跳转到的 ARIN 端点常对 Worker 共享出口限流（8.8.8.8 通一次后
// 就 429/失败，而 APNIC 段的 1.1.1.1 正常），失败时直接并行问五大 RIR 的 RDAP 端点，
// 取第一个成功的结果；域名只能走 rdap.org（注册商无法从域名推断）。
const RIR_RDAP = [
  'https://rdap.arin.net/registry', 'https://rdap.db.ripe.net',
  'https://rdap.apnic.net', 'https://rdap.lacnic.net/rdap',
  'https://rdap.afrinic.net/rdap',
];
async function fetchRdap(rdapUrl, type, q) {
  try { return await fetchJSON(rdapUrl, 8000); }
  catch (e) {
    if (type === 'domain') throw e;
    const kind = type === 'autnum' ? 'autnum' : 'ip';
    const tried = await Promise.allSettled(
      RIR_RDAP.map(base => fetchJSON(`${base}/${kind}/${encodeURIComponent(q)}`, 8000))
    );
    const good = tried.find(t => t.status === 'fulfilled' && t.value && t.value.objectClassName);
    if (good) return good.value;
    throw e;
  }
}
function dohAnswers(d) {
  return (d.Answer || []).filter(a => a.data).map(a => String(a.data).replace(/\.$/, ''));
}
async function dohQuery(name, type, provider) {
  const enc = encodeURIComponent(name);
  try {
    if (provider === 'google') {
      const d = await fetchJSON(`https://dns.google/resolve?name=${enc}&type=${type}`);
      return dohAnswers(d);
    }
    if (provider === 'cloudflare') {
      const d = await fetchJSON(`https://cloudflare-dns.com/dns-query?name=${enc}&type=${type}`, 5000, { accept: 'application/dns-json' });
      return dohAnswers(d);
    }
    if (provider === 'alidns') {
      const d = await fetchJSON(`https://dns.alidns.com/resolve?name=${enc}&type=${type === 'A' ? 1 : type === 'AAAA' ? 28 : 12}`);
      return dohAnswers(d);
    }
    if (provider === 'dohpub') {
      const d = await fetchJSON(`https://doh.pub/dns-query?name=${enc}&type=${type}`, 5000, { accept: 'application/dns-json' });
      return dohAnswers(d);
    }
  } catch (e) { return null; }
  return null;
}
const DOH_PROVIDERS = [
  ['google', 'Google DNS'], ['cloudflare', 'Cloudflare 1.1.1.1'],
  ['alidns', '阿里 DNS'], ['dohpub', 'DNSPod'],
];


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const ip = request.headers.get('cf-connecting-ip') || '';
    const cf = request.cf || {};

    // 纯文本接口（ping0 式）：curl 直接拿 IP
    if (path === '/ipv4' || path === '/ipv6') {
      const want6 = path === '/ipv6';
      const ok = want6 ? ip.includes(':') : !ip.includes(':');
      return new Response(ok ? ip + '\n' : '', { headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });
    }
    // 根路径始终返回页面；纯文本 IP 用 /ipv4、/ipv6、/geo（UA 检测经代理后不可靠，不依赖它）
    if (path === '/geo') {
      const me = { ip, country: cf.country, city: cf.city, asn: cf.asn, org: cf.asOrganization };
      if (url.searchParams.get('format') === 'json') return json(me);
      const line2 = [cf.country, cf.region, cf.city].filter(Boolean).join(' ');
      return new Response(`${ip}\n${line2}\nAS${cf.asn || ''}\n${cf.asOrganization || ''}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });
    }

    if (path === '/api/me') {
      return json({
        ip, source: 'cloudflare', country: cf.country || '', countryCode: cf.country || '',
        region: cf.region || '', city: cf.city || '', timezone: cf.timezone || '',
        lat: cf.latitude != null ? Number(cf.latitude) : null, lon: cf.longitude != null ? Number(cf.longitude) : null,
        asn: cf.asn ? `AS${cf.asn}` : '', as: cf.asn ? `AS${cf.asn}` : '', asname: cf.asOrganization || '', org: cf.asOrganization || '', isp: cf.asOrganization || '',
        colo: cf.colo || '', postalCode: cf.postalCode || '', zip: cf.postalCode || '',
        mobile: false, proxy: false, hosting: false,
      });
    }

    if (path === '/api/lookup') {
      const q = (url.searchParams.get('ip') || '').trim();
      if (!q || !isIP(q)) return json({ error: 'bad_ip', message: '请传一个有效的 IP' }, 400);
      const data = await cachedLookup(q, ctx);
      if (data.error) return json(data, data.error === 'rate_limited' ? 429 : 502);
      return json(data, 200, 86400);
    }

    if (path === '/api/resolve') {
      const domain = (url.searchParams.get('domain') || '').trim();
      if (!domain || !/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) return json({ error: 'bad_domain' }, 400);
      try {
        const [a, aaaa] = await Promise.all([
          fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`).then(r => r.json()),
          fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=AAAA`).then(r => r.json()),
        ]);
        const ips = [...(a.Answer || []), ...(aaaa.Answer || [])].map(x => x.data).filter(x => isIP(x));
        return json({ domain, ips: [...new Set(ips)] }, 200, 86400);
      } catch (e) { return json({ error: 'resolve_failed' }, 502); }
    }

    if (path === '/api/rdns') {
      const q = (url.searchParams.get('ip') || '').trim();
      if (!q || !isIP(q)) return json({ error: 'bad_ip', message: '请传一个有效的 IP' }, 400);
      let name;
      if (isIPv4(q)) {
        name = `${q.split('.').reverse().join('.')}.in-addr.arpa`;
      } else {
        // IPv6：展开压缩形式，按 nibble 反转 + ip6.arpa
        const [head, tail] = q.split('::');
        const h = (head ? head.split(':') : []).filter(Boolean);
        const t = (tail ? tail.split(':') : []).filter(Boolean);
        const missing = 8 - h.length - t.length;
        const full = [...h, ...Array(Math.max(0, missing)).fill('0'), ...t]
          .map(g => g.padStart(4, '0')).join('');
        if (full.length !== 32) return json({ ip: q, hostname: '' });
        name = `${full.split('').reverse().join('.')}.ip6.arpa`;
      }
      try {
        const r = await fetch(`https://dns.google/resolve?name=${name}&type=PTR`);
        const d = await r.json();
        const host = (d.Answer || [])[0]?.data || '';
        return json({ ip: q, hostname: host.replace(/\.$/, '') }, 200, 86400);
      } catch (e) { return json({ error: 'rdns_failed' }, 502); }
    }

    if (path === '/api/asn') {
      const m = (url.searchParams.get('as') || '').trim().match(/^AS?(\d+)$/i);
      if (!m) return json({ error: 'bad_asn', message: '请传 AS15169 这样的 ASN' }, 400);
      const num = m[1];
      try {
        const [ov, pf] = await Promise.all([
          fetch(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${num}`).then(r => r.json()),
          fetch(`https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS${num}`).then(r => r.json()),
        ]);
        return json({
          asn: `AS${num}`, holder: ov?.data?.holder || '', announced: !!ov?.data?.announced,
          prefixes: (pf?.data?.prefixes || []).slice(0, 10).map(p => p.prefix),
          source: 'stat.ripe.net',
        }, 200, 86400);
      } catch (e) { return json({ error: 'asn_failed' }, 502); }
    }

    if (path === '/api/rdap') {
      const q = (url.searchParams.get('query') || '').trim();
      if (!q) return json({ error: 'bad_query', message: '请传 IP、ASN 或域名' }, 400);
      let rdapUrl, type;
      const asMatch = q.match(/^AS?(\d+)$/i);
      if (isIP(q)) { rdapUrl = `https://rdap.org/ip/${encodeURIComponent(q)}`; type = 'ip'; }
      else if (asMatch) { rdapUrl = `https://rdap.org/autnum/${asMatch[1]}`; type = 'autnum'; }
      else if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(q)) { rdapUrl = `https://rdap.org/domain/${encodeURIComponent(q)}`; type = 'domain'; }
      else return json({ error: 'bad_query', message: '请传 IP、ASN 或域名' }, 400);
      const cache = caches.default;
      const cacheKey = new Request(`https://rdap.qinlv/${type}/${q}`);
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
      try {
        const d = await fetchRdap(rdapUrl, type, q);
        const res = json(normalizeRdap(q, type, d), 200, 86400);
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      } catch (e) { return json({ error: 'rdap_failed', message: 'RDAP 查询失败，请稍候再试' }, 502); }
    }

    if (path === '/api/dns-multi') {
      const domain = (url.searchParams.get('domain') || '').trim();
      const qip = (url.searchParams.get('ip') || '').trim();
      const cache = caches.default;
      if (domain) {
        if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) return json({ error: 'bad_domain' }, 400);
        const cacheKey = new Request(`https://dnsmulti.qinlv/${domain}`);
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
        const resolvers = await Promise.all(DOH_PROVIDERS.map(async ([id, name]) => {
          const [a, aaaa] = await Promise.all([dohQuery(domain, 'A', id), dohQuery(domain, 'AAAA', id)]);
          return { id, name, a: a || [], aaaa: aaaa || [], ok: a !== null || aaaa !== null };
        }));
        const res = json({ domain, resolvers }, 200, 86400);
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      }
      if (qip) {
        if (!isIP(qip)) return json({ error: 'bad_ip' }, 400);
        let name;
        if (isIPv4(qip)) name = `${qip.split('.').reverse().join('.')}.in-addr.arpa`;
        else {
          const [head, tail] = qip.split('::');
          const h = (head ? head.split(':') : []).filter(Boolean);
          const t = (tail ? tail.split(':') : []).filter(Boolean);
          const full = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t].map(g => g.padStart(4, '0')).join('');
          if (full.length !== 32) return json({ ip: qip, resolvers: [] });
          name = `${full.split('').reverse().join('.')}.ip6.arpa`;
        }
        const resolvers = await Promise.all(DOH_PROVIDERS.map(async ([id, rname]) => {
          const ptr = await dohQuery(name, 'PTR', id);
          return { id, name: rname, ptr: ptr || [], ok: ptr !== null };
        }));
        return json({ ip: qip, resolvers });
      }
      return json({ error: 'bad_query', message: '请传 domain 或 ip' }, 400);
    }

    if (path === '/api') {
      return json({
        name: 'qinlv-ip-query', version: '2.0',
        endpoints: ['GET /api/me', 'GET /api/lookup?ip=8.8.8.8', 'GET /api/rdap?query=8.8.8.8', 'GET /api/dns-multi?domain=dns.google', 'GET /api/dns-multi?ip=8.8.8.8', 'GET /api/resolve?domain=dns.google', 'GET /api/rdns?ip=8.8.8.8', 'GET /api/asn?as=AS15169', 'GET /geo', 'GET /ipv4', 'GET /ipv6'],
      });
    }

    // Top IP 落地页：服务端渲染（可收录）
    const ipMatch = path.match(/^\/ip\/([^/]+)$/);
    if (ipMatch) {
      const q = decodeURIComponent(ipMatch[1]);
      if (isIP(q) && TOP_IPS.includes(q)) {
        const ssr = await renderLanding(request, env, ctx, q);
        if (ssr) return ssr;
      }
    }
    // 静态页面：/ip/<查询> 走 SPA 回退到 index.html
    if (env.ASSETS) {
      let res = await env.ASSETS.fetch(request);
      if (res.status === 404 && (path.startsWith('/ip/') || path === '/ip')) {
        const indexReq = new Request(new URL('/', request.url), request);
        res = await env.ASSETS.fetch(indexReq);
        // 非 Top IP 的 /ip/ 页：SPA 可用，但不参与收录
        const h = new Headers(res.headers);
        h.set('x-robots-tag', 'noindex');
        return new Response(res.body, { status: res.status, headers: h });
      }
      if (res.status === 404) {
        return new Response(notFoundPage(), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' } });
      }
      // 静态资源：浏览器每次回源验证，边缘缓存 1 小时、过期后可复用 1 天
      const h = new Headers(res.headers);
      h.set('cache-control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
      return new Response(res.body, { status: res.status, headers: h });
    }
    return new Response('Not found', { status: 404 });
  },
};
