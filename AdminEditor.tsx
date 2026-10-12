import {useState} from 'react';import {api} from './api';
type Data=Record<string,string|number|boolean|null>;
type Props={title:string,path:string,method?:string,sample:Data,onSaved?:()=>void};
const labels:Record<string,string>={name:'Nama paket',price:'Harga (rupiah)',durationDays:'Masa aktif (hari, kosong = permanen)',productLimit:'Batas produk',platformFeeBps:'Fee platform (basis points, 100 = 1%)',active:'Aktif',role:'Role pengguna',code:'Kode promo',percent:'Diskon (%)',expiresAt:'Berlaku sampai (ISO 8601)',userId:'ID pengguna tujuan',message:'Pesan notifikasi'};
export function AdminEditor({title,path,method='POST',sample,onSaved}:Props){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false);
 return <form className="panel space-y-4" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);const output:Data={};
  for(const [key,value]of Object.entries(sample)){
   const text=String(data.get(key)??'');output[key]=key==='durationDays'?(text.trim()===''?null:Number(text)):typeof value==='boolean'?data.has(key):typeof value==='number'?Number(text):text;
  }
  if(path.includes('/notifications')&&!window.confirm(`Kirim notifikasi ke ${output.userId}?`))return;
  setBusy(true);setError('');setSuccess(false);
  void api(path,method,output).then(()=>{setSuccess(true);onSaved?.();}).catch(e=>setError(e.message)).finally(()=>setBusy(false));
 }}><h2>{title}</h2>{Object.entries(sample).map(([key,value])=><label key={key}>{labels[key]??key}{key==='role'?<select name={key} defaultValue={String(value)}>{['CUSTOMER','RESELLER','ADMIN','SUPER_ADMIN'].map(r=><option key={r}>{r}</option>)}</select>:typeof value==='boolean'?<input name={key} type="checkbox" defaultChecked={value} className="h-5 w-5"/>:key==='message'?<textarea name={key} defaultValue={String(value??'')} maxLength={2000} required rows={5}/>:<input name={key} type={typeof value==='number'||key==='durationDays'?'number':'text'} defaultValue={value===null?'':String(value)} required={key!=='durationDays'} min={key==='platformFeeBps'?0:1} max={key==='platformFeeBps'?10000:key==='percent'?90:undefined} maxLength={key==='code'?40:undefined}/>}</label>)}{error&&<p role="alert" className="text-red-300">{error}</p>}{success&&<p role="status" className="text-emerald-300">Data tersimpan.</p>}<button disabled={busy}>{busy?'Menyimpan...':'Simpan'}</button></form>;
}
