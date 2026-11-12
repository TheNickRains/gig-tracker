const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0,168].includes(b)) ||
      (a === 198 && [18,19,51].includes(b)) || (a === 203 && b === 0));
  }
  // Accept only global-unicast v6; reject mapped IPv4 and transition ranges.
  return net.isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^2001:(?:0*:|0?db8:|0?10:|0?20:)/i.test(address) && !/^2002:/i.test(address);
}
async function safeSiteFetch(input, options = {}) {
  const lookup = options.lookup || dns.lookup;
  const request = options.request || ((url, opts, cb) => (url.protocol === 'https:' ? https : http).request(url, opts, cb));
  const deadline = Date.now() + (options.timeoutMs || 10000);
  let url = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))) throw Error('Use a public HTTP or HTTPS website');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const answers = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Website DNS lookup timed out')),Math.max(1,deadline-Date.now()));
      Promise.resolve().then(()=>lookup(host,{all:true,verbatim:true})).then(resolve,reject).finally(()=>clearTimeout(timer));
    });
    if (!answers.length || answers.some(a => !publicAddress(a.address))) throw Error('Website address must resolve to a public server');
    const timeLeft = deadline - Date.now();
    if (timeLeft <= 0) throw Error('Website request timed out');
    const response = await new Promise((resolve, reject) => {
      const req = request(url, {
        method: 'GET', headers: { 'User-Agent': 'GigCollective/1.0', Accept: 'text/html,text/plain' },
        // Pin the checked DNS answer while retaining the URL hostname for TLS.
        lookup(_hostname, opts, cb) { if (opts?.all) cb(null, [answers[0]]); else cb(null, answers[0].address, answers[0].family); }
      }, res => {
        if ([301,302,303,307,308].includes(res.statusCode)) { res.resume(); if(!res.headers.location)reject(Error('Website redirect has no location'));else resolve({ redirect: res.headers.location }); return; }
        if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); reject(Error('Website returned HTTP ' + res.statusCode)); return; }
        const type = String(res.headers['content-type'] || 'text/html');
        if (!/^text\/(html|plain)|^application\/xhtml\+xml/i.test(type)) { res.resume(); reject(Error('Website is not a text page')); return; }
        let size = 0; const chunks = [];
        res.on('data', chunk => { size += chunk.length; if (size > 512 * 1024) { req.destroy(Error('Website page is too large')); return; } chunks.push(chunk); });
        res.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      });
      const timer = setTimeout(() => req.destroy(Error('Website request timed out')), timeLeft);
      req.on('error', reject); req.on('close', () => clearTimeout(timer)); req.end();
    });
    if (!response.redirect) return response.text;
    url = new URL(response.redirect, url);
  }
  throw Error('Too many website redirects');
}
module.exports = { safeSiteFetch, publicAddress };
