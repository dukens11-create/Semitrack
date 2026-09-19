export type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  role: "ADMIN" | "FLEET_ADMIN" | "MODERATOR" | "DRIVER";
  plan: string;
  operationalPermissions?: string[];
  staffRole?: string;
};

const API_URL = String(import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 20_000;
const accessKey = "semitrax.admin.access";
const refreshKey = "semitrax.admin.refresh";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let sessionGeneration = 0;

export const session = {
  access: () => {
    try { return sessionStorage.getItem(accessKey); } catch { return null; }
  },
  save: (access: string, refresh: string) => {
    try {
      sessionStorage.setItem(accessKey, access);
      sessionStorage.setItem(refreshKey, refresh);
    } catch {
      throw new ApiError(0, "Secure browser storage is unavailable");
    }
  },
  clear: () => {
    sessionGeneration++;
    try {
      sessionStorage.removeItem(accessKey);
      sessionStorage.removeItem(refreshKey);
    } catch { /* Local sign-out must still complete. */ }
  },
};

function refreshToken() {
  try { return sessionStorage.getItem(refreshKey); } catch { return null; }
}

async function send(path: string, init: RequestInit): Promise<{status:number;ok:boolean;body:unknown}> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new ApiError(0,'Invalid API path');
  if (init.signal?.aborted) throw new ApiError(0,'Request cancelled');
  const controller = new AbortController();
  const cancel=()=>controller.abort();init.signal?.addEventListener('abort',cancel);
  let rejectDeadline:(error:Error)=>void=()=>{};
  const deadline=new Promise<never>((_resolve,reject)=>{rejectDeadline=reject;});
  const failCancel=()=>rejectDeadline(new ApiError(0,'Request cancelled'));init.signal?.addEventListener('abort',failCancel);
  const timer=window.setTimeout(()=>{cancel();rejectDeadline(new ApiError(0,'The SemiTraX server took too long to respond'));},REQUEST_TIMEOUT_MS);
  try {
    const response=await Promise.race([fetch(API_URL+path,{...init,signal:controller.signal}),deadline]);
    const text=await Promise.race([response.text(),deadline]);
    if(text.length>4_000_000)throw new ApiError(response.status,'SemiTraX returned an oversized response');
    let body:unknown=null;
    try {body=text?JSON.parse(text):null;}catch{throw new ApiError(response.status,'SemiTraX returned an invalid response');}
    if (response.ok && response.status!==204 && body===null) throw new ApiError(response.status,'SemiTraX returned an invalid response');
    return {status:response.status,ok:response.ok,body};
  }catch(error){
    if(error instanceof ApiError)throw error;
    throw new ApiError(0,init.signal?.aborted?'Request cancelled':controller.signal.aborted?'The SemiTraX server took too long to respond':'Unable to connect to SemiTraX');
  }finally{window.clearTimeout(timer);init.signal?.removeEventListener('abort',cancel);init.signal?.removeEventListener('abort',failCancel);}
}
async function request<T>(path: string, init: RequestInit = {}, retry=true):Promise<T>{
  const generation=sessionGeneration;const publicRequest=path.startsWith('/auth/');
  const headers=new Headers(init.headers);headers.set('Accept','application/json');
  if(init.body)headers.set('Content-Type','application/json');
  const token=publicRequest?null:session.access();if(token)headers.set('Authorization','Bearer '+token);
  const response=await send(path,{...init,headers});
  if(generation!==sessionGeneration)throw new ApiError(401,'Your session changed. Sign in again.');
  if(response.status===401 && !publicRequest && retry && refreshToken()){
    const refreshed=await refresh();
    if(generation!==sessionGeneration)throw new ApiError(401,'Your session changed. Sign in again.');
    if(refreshed)return request<T>(path,init,false);
  }
  if(!response.ok){
    if(response.status===401 && !publicRequest)session.clear();
    const messages:Record<number,string>={400:'Review the supplied information.',401:'Please sign in again.',403:'This action is not authorized for your account.',404:'The requested record is unavailable.',409:'This information changed. Refresh and review it.',429:'Too many requests. Please wait and retry.'};
    throw new ApiError(response.status,messages[response.status]??'SemiTraX is temporarily unavailable. Please try again.');
  }
  return response.body as T;
}
let refreshInFlight:Promise<boolean>|null=null;
function refresh(){
  if(refreshInFlight)return refreshInFlight;
  const flight=performRefresh().finally(()=>{if(refreshInFlight===flight)refreshInFlight=null;});
  refreshInFlight=flight;return flight;
}
async function performRefresh(){
  const generation=sessionGeneration;const token=refreshToken();if(!token)return false;
  const response=await send('/auth/refresh',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({refreshToken:token})});
  if(generation!==sessionGeneration)return false;
  if(response.status===400||response.status===401){session.clear();return false;}
  if(!response.ok)throw new ApiError(response.status,'Session refresh is temporarily unavailable. Retry when connected.');
  const body=response.body as {accessToken?:unknown;refreshToken?:unknown}|null;
  if(!body||typeof body.accessToken!=='string'||!body.accessToken||typeof body.refreshToken!=='string'||!body.refreshToken)throw new ApiError(502,'Invalid session response');
  session.save(body.accessToken,body.refreshToken);return true;
}

export async function signOut() {
  const token=refreshToken();session.clear();
  if(token){
    const response=await send('/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:token})});
    if(!response.ok)throw new ApiError(response.status,'Remote sign-out could not be confirmed. Local sign-out is complete.');
  }
}
function validateLogin(value:unknown):{accessToken:string;refreshToken:string;user:AdminUser}{
 const v=value as {accessToken?:unknown;refreshToken?:unknown;user?:Partial<AdminUser>}|null;
 if(!v||typeof v.accessToken!=='string'||!v.accessToken||typeof v.refreshToken!=='string'||!v.refreshToken||!v.user||typeof v.user.id!=='string'||!v.user.id||typeof v.user.email!=='string'||typeof v.user.fullName!=='string'||!['ADMIN','FLEET_ADMIN','MODERATOR','DRIVER'].includes(String(v.user.role))||typeof v.user.plan!=='string')throw new ApiError(502,'SemiTraX returned an invalid session response');
 return v as {accessToken:string;refreshToken:string;user:AdminUser};
}
export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  login: (email: string, password: string) => request<{ accessToken: string; refreshToken: string; user: AdminUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  }).then(validateLogin),
};
