// Expose ONLY verified payment webhook routes through a temporary sandbox tunnel.
const http=require('node:http');
const routes=new Set(['/api/v1/billing/stripe/webhook','/api/v1/billing/paypal/webhook']);
http.createServer(async(req,res)=>{
  if(req.method!=='POST'||!routes.has(req.url)){res.writeHead(404);res.end();return;}
  const chunks=[];let bytes=0;
  try{
    for await(const part of req){bytes+=part.length;if(bytes>1024*1024){res.writeHead(413);res.end();return;}chunks.push(part);}
    const headers={...req.headers};delete headers.host;delete headers['content-length'];delete headers.connection;delete headers['transfer-encoding'];
    const upstream=await fetch('http://127.0.0.1:3411'+req.url,{method:'POST',headers,body:Buffer.concat(chunks),signal:AbortSignal.timeout(30000)});
    res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(await upstream.text());
  }catch{res.writeHead(502);res.end('{"error":"upstream_unavailable"}');}
}).listen(3422,'127.0.0.1',()=>console.log('Sandbox webhook-only ingress on 127.0.0.1:3422'));
