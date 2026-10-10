// AKKAD Cloudflare Worker. Deploy only after BACKEND_ORIGIN is configured as a secret/variable.
export default {
  async fetch(request, env) {
    if (!env.BACKEND_ORIGIN) {
      return Response.json({ok:false,error:'BACKEND_ORIGIN is not configured'}, {status:503});
    }
    const backend=new URL(env.BACKEND_ORIGIN);
    if(backend.protocol!=='https:') return Response.json({error:'HTTPS origin required'},{status:503});
    const target=new URL(request.url);
    target.protocol='https:';
    target.host=backend.host;
    target.port='';
    const headers=new Headers(request.headers);
    headers.delete('cookie');
    headers.set('x-akkad-gateway','cloudflare');
    const response=await fetch(new Request(target.toString(),{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:'manual'}));
    const final=new Response(response.body,response);
    final.headers.set('x-content-type-options','nosniff');
    return final;
  }
};
