let csrf='';export function setCsrf(v:string){csrf=v;}
export async function api(path:string,method='GET',data?:unknown):Promise<any>{
 const form=data instanceof FormData;const headers:Record<string,string>={};
 if(method!=='GET'){headers['X-CSRF-Token']=csrf;if(!form)headers['Content-Type']='application/json';}
 const response=await fetch(`/api${path}`,{method,credentials:'include',headers,body:data===undefined?undefined:form?data:JSON.stringify(data)});
 const body=await response.json().catch(()=>({error:'Respons tidak valid'}));if(!response.ok)throw new Error(body.error??`HTTP ${response.status}`);return body;
}
